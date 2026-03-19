from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt
import random
from collections import defaultdict
import asyncio
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get('JWT_SECRET')
if not JWT_SECRET:
    if os.environ.get('ENVIRONMENT') == 'production':
        raise RuntimeError("JWT_SECRET must be set in production environment")
    JWT_SECRET = 'sukunaW_secret_key_2026'
    
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 168

RECAPTCHA_SECRET = os.environ.get('RECAPTCHA_SECRET')
if not RECAPTCHA_SECRET:
    logger.warning("RECAPTCHA_SECRET not set - captcha verification will be skipped in dev mode")

async def verify_captcha(captcha_token: str):
    """Verify reCAPTCHA v2 token with Google"""
    if not RECAPTCHA_SECRET:
        return True
    if not captcha_token:
        raise HTTPException(status_code=400, detail="Капча обязательна")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client_http:
            response = await client_http.post(
                "https://www.google.com/recaptcha/api/siteverify",
                data={"secret": RECAPTCHA_SECRET, "response": captcha_token}
            )
            result = response.json()
            if not result.get("success"):
                logger.warning(f"reCAPTCHA verification failed: {result.get('error-codes', [])}")
                raise HTTPException(status_code=400, detail="Проверка капчи не пройдена")
            return True
    except httpx.TimeoutException:
        logger.error("reCAPTCHA verification timeout")
        raise HTTPException(status_code=503, detail="Сервис проверки капчи недоступен, попробуйте позже")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"reCAPTCHA verification error: {type(e).__name__}")
        raise HTTPException(status_code=503, detail="Ошибка проверки капчи, попробуйте позже")

security = HTTPBearer()

app = FastAPI()
api_router = APIRouter(prefix="/api")

rate_limit_store = defaultdict(list)
RATE_LIMIT_REQUESTS = 40
RATE_LIMIT_WINDOW = 10

AUTH_RATE_LIMIT_REGISTER = 3
AUTH_RATE_LIMIT_LOGIN = 5
AUTH_RATE_LIMIT_WINDOW = 60

USERNAME_RATE_LIMIT_LOGIN = 5
USERNAME_RATE_LIMIT_REGISTER = 3

MAX_FAILED_LOGINS_IP = 5
PROGRESSIVE_DELAYS = [0, 0, 1, 2, 5, 10, 30, 60, 120]
FAILED_LOGIN_LOCKOUT = 300

async def check_rate_limit(request: Request, endpoint_type: str = "general", username: str = None):
    """
    Rate limiting with different limits for different endpoint types
    SECURITY FIX: Dual protection - by IP AND by username (anti-proxy)
    
    - general: 40 requests per 10 seconds per IP
    - register: 3 requests per minute per IP + username pattern check
    - login: 5 requests per minute per IP + 5 per minute per username (ANY IP)
    """
    forwarded_for = request.headers.get("x-forwarded-for")
    client_ip = forwarded_for.split(",")[0].strip() if forwarded_for else request.client.host
    
    user_agent = request.headers.get("user-agent", "").lower()
    
    suspicious_agents = ["bot", "crawler", "spider", "scraper"]
    if any(agent in user_agent for agent in suspicious_agents):
        if "googlebot" not in user_agent and "bingbot" not in user_agent:
            logger.warning(f"Suspicious user agent from {client_ip}: {user_agent}")
    
    now = datetime.now(timezone.utc).timestamp()
    
    if endpoint_type == "register":
        max_requests = AUTH_RATE_LIMIT_REGISTER
        window = AUTH_RATE_LIMIT_WINDOW
        store_key = f"{client_ip}_register"
    elif endpoint_type == "login":
        max_requests = AUTH_RATE_LIMIT_LOGIN
        window = AUTH_RATE_LIMIT_WINDOW
        store_key = f"{client_ip}_login"
    else:
        max_requests = RATE_LIMIT_REQUESTS
        window = RATE_LIMIT_WINDOW
        store_key = client_ip
    
    rate_limit_store[store_key] = [
        ts for ts in rate_limit_store[store_key]
        if now - ts < window
    ]
    
    if len(rate_limit_store[store_key]) >= max_requests:
        remaining_time = int(window - (now - rate_limit_store[store_key][0]))
        raise HTTPException(
            status_code=429,
            detail=f"Слишком много запросов. Подождите {remaining_time} секунд"
        )
    
    rate_limit_store[store_key].append(now)
    
    if username and endpoint_type in ["login", "register"]:
        username_key = f"username_{username.lower()}_{endpoint_type}"
        
        rate_limit_store[username_key] = [
            ts for ts in rate_limit_store[username_key]
            if now - ts < AUTH_RATE_LIMIT_WINDOW
        ]
        
        username_limit = USERNAME_RATE_LIMIT_LOGIN if endpoint_type == "login" else USERNAME_RATE_LIMIT_REGISTER
        
        if len(rate_limit_store[username_key]) >= username_limit:
            remaining_time = int(AUTH_RATE_LIMIT_WINDOW - (now - rate_limit_store[username_key][0]))
            raise HTTPException(
                status_code=429,
                detail=f"Слишком много попыток для этого имени. Подождите {remaining_time} секунд"
            )
        
        rate_limit_store[username_key].append(now)

async def check_failed_login_attempts(client_ip: str, username: str):
    """
    Track failed login attempts in MongoDB (persistent across restarts)
    SECURITY FIX: Progressive delay for username (anti-DoS) instead of blocking
    
    IP lockout: 5 attempts → hard block 5 minutes
    Username delay: Progressive (1s, 2s, 5s, 10s, 30s, 60s, 120s) - PREVENTS DoS
    """
    now = datetime.now(timezone.utc)
    lockout_threshold = now - timedelta(seconds=FAILED_LOGIN_LOCKOUT)
    
    ip_attempts = await db.failed_logins.count_documents({
        "ip": client_ip,
        "timestamp": {"$gte": lockout_threshold}
    })
    
    if ip_attempts >= MAX_FAILED_LOGINS_IP:
        raise HTTPException(
            status_code=429,
            detail=f"Слишком много неудачных попыток с этого IP. Подождите {FAILED_LOGIN_LOCKOUT // 60} мин."
        )
    
    username_attempts = await db.failed_logins.count_documents({
        "username": username.lower(),
        "timestamp": {"$gte": lockout_threshold}
    })
    
    if username_attempts > 0:
        delay_index = min(username_attempts, len(PROGRESSIVE_DELAYS) - 1)
        required_delay = PROGRESSIVE_DELAYS[delay_index]
        
        if required_delay > 0:
            last_attempt = await db.failed_logins.find_one(
                {"username": username.lower()},
                sort=[("timestamp", -1)]
            )
            
            if last_attempt:
                time_since_last = (now - last_attempt["timestamp"]).total_seconds()
                
                if time_since_last < required_delay:
                    remaining_delay = int(required_delay - time_since_last)
                    
                    if username_attempts >= 5:
                        logger.warning(
                            f"Suspicious login activity for username '{username}': "
                            f"{username_attempts} attempts in 5 minutes"
                        )
                    
                    raise HTTPException(
                        status_code=429,
                        detail=f"Подождите {remaining_delay} сек. перед следующей попыткой"
                    )

async def record_failed_login(client_ip: str, username: str):
    """
    Record failed login attempt in MongoDB (persistent)
    No blocking - only progressive delay (see check_failed_login_attempts)
    """
    now = datetime.now(timezone.utc)
    
    await db.failed_logins.insert_one({
        "ip": client_ip,
        "username": username.lower(),
        "timestamp": now,
        "createdAt": now.isoformat()
    })

async def clear_failed_login_attempts(client_ip: str, username: str):
    """
    Clear failed login attempts after successful login (from MongoDB)
    """
    await db.failed_logins.delete_many({"ip": client_ip})
    
    await db.failed_logins.delete_many({"username": username.lower()})

def detect_suspicious_username_pattern(username: str) -> bool:
    """
    Detect suspicious username patterns (mass registration attempts)
    Examples: test1, test2, test3 / user001, user002 / bot_1, bot_2
    
    NOTE: This is ADDITIONAL protection, not critical (easily bypassed)
    """
    username_lower = username.lower()
    
    import re
    if re.match(r'^[a-z]+\d+$', username_lower):
        base_name = re.sub(r'\d+$', '', username_lower)
        generic_names = ['test', 'user', 'bot', 'fake', 'temp', 'demo', 'sample', 'example']
        if base_name in generic_names:
            return True
    
    if re.match(r'^[a-z]+[_-]\d+$', username_lower):
        base_name = re.sub(r'[_-]\d+$', '', username_lower)
        if base_name in ['test', 'user', 'bot', 'fake', 'temp']:
            return True
    
    if username_lower.isdigit() and len(username_lower) <= 4:
        return True
    
    return False

async def check_mass_registration_pattern(username: str, client_ip: str):
    """
    Check for mass registration patterns from same IP
    """
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    
    import re
    base_pattern = re.sub(r'\d+$', '', username.lower())
    base_pattern = re.sub(r'[_-]\d+$', '', base_pattern)
    
    similar_count = await db.users.count_documents({
        "registrationIP": client_ip,
        "createdAt": {"$gte": one_hour_ago.isoformat()},
        "username": {"$regex": f"^{base_pattern}", "$options": "i"}
    })
    
    if similar_count >= 2:
        raise HTTPException(
            status_code=400,
            detail="Обнаружена подозрительная активность. Регистрация временно недоступна"
        )

class UserRegister(BaseModel):
    username: str
    password: str
    captcha: str = ""

class UserLogin(BaseModel):
    username: str
    password: str
    captcha: str = ""

class GameResult(BaseModel):
    score: int = Field(ge=0, le=3000)
    timePlayedSeconds: int = Field(ge=0, le=600)

class PurchaseRequest(BaseModel):
    itemType: str
    itemName: Optional[str] = None

class TransferRequest(BaseModel):
    toUsername: str
    amount: int = Field(gt=0, le=50000)

class AdminAddCoins(BaseModel):
    targetUsername: str
    amount: int = Field(gt=0, le=100000)

class AdminDeleteUser(BaseModel):
    targetUsername: str

class AdminSetLevel(BaseModel):
    targetUsername: str
    level: int = Field(ge=1, le=100)

class BonusRequest(BaseModel):
    bonusType: str

class ChestRequest(BaseModel):
    chestId: str

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_token(user_id: str, username: str, is_admin: bool) -> str:
    payload = {
        "sub": user_id,
        "username": username,
        "is_admin": is_admin,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Токен истёк")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Неверный токен")

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    payload = decode_token(credentials.credentials)
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    if user.get("isBanned"):
        raise HTTPException(status_code=403, detail="Ваш аккаунт заблокирован")
    
    return user

async def verify_admin(user: dict) -> bool:
    """SECURITY FIX: Always verify admin status from database, not just from token"""
    fresh_user = await db.users.find_one({"id": user["id"]}, {"_id": 0, "isAdmin": 1})
    return fresh_user and fresh_user.get("isAdmin", False)

def calculate_level(xp: int) -> int:
    level = 1
    xp_for_next = 100
    remaining_xp = xp
    while remaining_xp >= xp_for_next and level < 100:
        remaining_xp -= xp_for_next
        level += 1
        xp_for_next = int(xp_for_next * 1.15)
    return level

async def check_suspicious_activity(user_id: str, old_coins: int, new_coins: int, old_xp: int, new_xp: int, old_level: int, new_level: int, from_admin: bool = False, username: str = None):
    """
    Auto-ban for suspicious gains:
    - Coins gain >5000 at once (unless from admin)
    - XP gain >1000 at once (unless from admin)
    - Level jump >5 at once (unless from admin)
    - Negative balance (always ban)
    
    PROTECTION: Creator (pseudotamine) is immune to auto-ban
    """
    if username and username.lower() == "pseudotamine":
        return
    
    coins_gain = new_coins - old_coins
    xp_gain = new_xp - old_xp
    level_jump = new_level - old_level
    
    suspicious = False
    reason = ""
    
    if not from_admin:
        if coins_gain > 5000:
            suspicious = True
            reason = f"Подозрительное начисление монет: +{coins_gain}"
        elif xp_gain > 1000:
            suspicious = True
            reason = f"Подозрительное начисление XP: +{xp_gain}"
        elif level_jump > 5:
            suspicious = True
            reason = f"Подозрительный прыжок уровня: +{level_jump}"
    
    if new_coins < 0 or new_xp < 0:
        suspicious = True
        reason = f"Отрицательный баланс (coins: {new_coins}, xp: {new_xp})"
    
    if suspicious:
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"isBanned": True}}
        )
        logger.warning(f"User {user_id} auto-banned: {reason}")
        raise HTTPException(
            status_code=403, 
            detail=f"Ваш аккаунт заблокирован"
        )

cooldown_store = defaultdict(dict)

async def check_cooldown(user_id: str, action: str, cooldown_seconds: int):
    """Check if user can perform action (cooldown protection)"""
    now = datetime.now(timezone.utc).timestamp()
    last_action = cooldown_store[user_id].get(action, 0)
    
    if now - last_action < cooldown_seconds:
        remaining = int(cooldown_seconds - (now - last_action))
        raise HTTPException(
            status_code=429,
            detail=f"Подождите {remaining} сек. перед следующим действием"
        )
    
    cooldown_store[user_id][action] = now

@api_router.post("/auth/register")
async def register(data: UserRegister, request: Request):
    await check_rate_limit(request, endpoint_type="register", username=data.username)
    
    await verify_captcha(data.captcha)
    
    forwarded_for = request.headers.get("x-forwarded-for")
    client_ip = forwarded_for.split(",")[0].strip() if forwarded_for else request.client.host
    
    if len(data.username) < 3 or len(data.username) > 20:
        raise HTTPException(status_code=400, detail="Имя пользователя должно быть от 3 до 20 символов")
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Пароль должен быть не менее 6 символов")
    
    if detect_suspicious_username_pattern(data.username):
        logger.warning(f"Suspicious username pattern detected: {data.username} from {client_ip}")
    
    await check_mass_registration_pattern(data.username, client_ip)
    
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    recent_registration = await db.users.find_one({
        "registrationIP": client_ip,
        "createdAt": {"$gte": one_hour_ago.isoformat()}
    })
    
    if recent_registration:
        raise HTTPException(
            status_code=429, 
            detail="Подождите 1 час перед следующей регистрацией"
        )
    
    accounts_from_ip = await db.users.count_documents({"registrationIP": client_ip})
    if accounts_from_ip >= 2:
        raise HTTPException(status_code=400, detail="Достигнут лимит аккаунтов с этого IP-адреса (максимум 2)")
    
    existing_user = await db.users.find_one(
        {"username": {"$regex": f"^{data.username}$", "$options": "i"}},
        {"_id": 1}
    )
    if existing_user:
        raise HTTPException(status_code=400, detail="Это имя пользователя уже занято")
    
    user_id = str(uuid.uuid4())
    user = {
        "id": user_id,
        "username": data.username,
        "passwordHash": hash_password(data.password),
        "roles": [],
        "roleGradients": [],
        "clan": None,
        "clanCategory": False,
        "purchaseHistory": [],
        "isAdmin": False,
        "isBanned": False,
        "approved": False,
        "loginAttempted": False,
        "lastGameTime": None,
        "lastDailyBonus": None,
        "lastWeeklyBonus": None,
        "chests": [],
        "registrationIP": client_ip,
        "createdAt": datetime.now(timezone.utc).isoformat()
    }
    
    try:
        await db.users.create_index(
            [("username", 1)],
            unique=True,
            collation={"locale": "en", "strength": 2},
            name="username_unique"
        )
    except Exception:
        pass
    
    try:
        await db.users.insert_one(user)
    except Exception as e:
        if "duplicate" in str(e).lower() or "E11000" in str(e):
            raise HTTPException(status_code=400, detail="Это имя пользователя уже занято")
        raise
    
    return {"success": True, "message": "Аккаунт создан! Теперь войдите в систему", "username": data.username}

@api_router.post("/auth/login")
async def login(data: UserLogin, request: Request):
    await check_rate_limit(request, endpoint_type="login", username=data.username)
    
    await verify_captcha(data.captcha)
    
    forwarded_for = request.headers.get("x-forwarded-for")
    client_ip = forwarded_for.split(",")[0].strip() if forwarded_for else request.client.host
    
    await check_failed_login_attempts(client_ip, data.username)
    
    user = await db.users.find_one({"username": {"$regex": f"^{data.username}$", "$options": "i"}}, {"_id": 0})
    
    if not user:
        hash_password("dummy_password_to_maintain_timing")
        await record_failed_login(client_ip, data.username)
        raise HTTPException(status_code=401, detail="Неверные учётные данные")
    
    if not verify_password(data.password, user["passwordHash"]):
        await record_failed_login(client_ip, data.username)
        raise HTTPException(status_code=401, detail="Неверные учётные данные")
    
    if user.get("isBanned"):
        raise HTTPException(status_code=403, detail="Ваш аккаунт заблокирован")
    
    if user.get("coins", 0) < 0 or user.get("xp", 0) < 0:
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"isBanned": True}}
        )
        raise HTTPException(status_code=403, detail="Ваш аккаунт заблокирован")
    
    is_creator = user["username"].lower() == CREATOR_USERNAME.lower()
    if not is_creator and not user.get("isAdmin", False) and not user.get("approved", False):
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"loginAttempted": True}}
        )
        raise HTTPException(status_code=403, detail="Ваш аккаунт ожидает одобрения администратора")
    
    await clear_failed_login_attempts(client_ip, user["username"])
    
    token = create_token(user["id"], user["username"], user.get("isAdmin", False))
    user_response = {k: v for k, v in user.items() if k != "passwordHash"}
    return {"token": token, "user": user_response}

@api_router.get("/auth/me")
async def get_me(user: dict = Depends(get_current_user), request: Request = None):
    return {k: v for k, v in user.items() if k != "passwordHash"}

@api_router.post("/game/submit")
async def submit_game_result(data: GameResult, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    is_creator = user["username"].lower() == CREATOR_USERNAME.lower()
    if not is_creator and not user.get("isAdmin", False) and not user.get("approved", False):
        raise HTTPException(status_code=403, detail="Ваш аккаунт ожидает одобрения администратора")
    
    await check_cooldown(user["id"], "game_submit", 10)
    
    max_possible_score = data.timePlayedSeconds * 5
    if data.score > max_possible_score or data.score < 0:
        raise HTTPException(status_code=400, detail="Недопустимый результат игры")
    if data.timePlayedSeconds > 600:
        raise HTTPException(status_code=400, detail="Недопустимая продолжительность игры")
    
    score = data.score
    if score >= 100:
        coins_earned = min(70 + (score - 100) // 5, 90)
    elif score >= 50:
        coins_earned = min(25 + (score - 50) // 3, 40)
    elif score >= 20:
        coins_earned = 10 + (score - 20) // 3
    else:
        coins_earned = max(3, score // 3)
    
    xp_earned = data.score // 3 + data.timePlayedSeconds * 2
    
    if coins_earned > 200 or xp_earned > 200:
        pending_win = {
            "id": str(uuid.uuid4()),
            "userId": user["id"],
            "username": user["username"],
            "gameType": "dodge",
            "score": data.score,
            "timePlayedSeconds": data.timePlayedSeconds,
            "coinsEarned": coins_earned,
            "xpEarned": xp_earned,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "status": "pending"
        }
        await db.pending_wins.insert_one(pending_win)
        
        return {
            "pending": True,
            "message": "Ваш выигрыш ожидает одобрения администрации",
            "coinsEarned": coins_earned,
            "xpEarned": xp_earned
        }
    
    now = datetime.now(timezone.utc)
    
    updated_user = await db.users.find_one_and_update(
        {
            "id": user["id"],
            "coins": {"$gte": 0},
            "xp": {"$gte": 0}
        },
        {
            "$inc": {
                "coins": coins_earned,
                "xp": xp_earned
            },
            "$set": {
                "lastGameTime": now.isoformat()
            }
        },
        return_document=True
    )
    
    if not updated_user:
        raise HTTPException(status_code=400, detail="Ошибка обновления данных")
    
    new_xp = updated_user["xp"]
    new_level = calculate_level(new_xp)
    new_coins = updated_user["coins"]
    
    if new_level != updated_user.get("level", 1):
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"level": new_level}}
        )
    
    old_coins = user.get("coins", 0)
    old_xp = user.get("xp", 0)
    old_level = user.get("level", 1)
    await check_suspicious_activity(user["id"], old_coins, new_coins, old_xp, new_xp, old_level, new_level, from_admin=False, username=user.get("username"))
    
    chest_dropped = None
    if data.score > 30 and random.random() < 0.1:
        chest_types = ['common', 'rare', 'epic']
        weights = [0.7, 0.25, 0.05]
        rand = random.random()
        cumulative = 0
        chest_type = 'common'
        for i, w in enumerate(weights):
            cumulative += w
            if rand < cumulative:
                chest_type = chest_types[i]
                break
        chest_dropped = {
            "id": str(int(now.timestamp() * 1000)),
            "type": chest_type,
            "droppedAt": now.isoformat()
        }
        
        await db.users.update_one(
            {"id": user["id"]},
            {"$push": {"chests": chest_dropped}}
        )
    
    return {
        "coinsEarned": coins_earned,
        "xpEarned": xp_earned,
        "totalCoins": new_coins,
        "totalXp": new_xp,
        "level": new_level,
        "chestDropped": chest_dropped
    }

SHOP_ITEMS = {
    "custom_role": {"price": 20000, "name": "Кастомная роль"},
    "custom_gradient": {"price": 25000, "name": "Градиент для роли"},
    "create_clan": {"price": 70000, "name": "Создание клана"},
    "clan_category": {"price": 80000, "name": "Категория клана"}
}

@api_router.get("/shop/items")
async def get_shop_items():
    return SHOP_ITEMS

@api_router.post("/shop/purchase")
async def purchase_item(data: PurchaseRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    if data.itemType not in SHOP_ITEMS:
        raise HTTPException(status_code=400, detail="Неверный тип товара")
    
    item = SHOP_ITEMS[data.itemType]
    price = item["price"]
    
    additional_updates = {}
    
    if data.itemType == "custom_role":
        if not data.itemName:
            raise HTTPException(status_code=400, detail="Введите название роли")
        if len(data.itemName) > 20:
            raise HTTPException(status_code=400, detail="Название роли не более 20 символов")
    elif data.itemType == "custom_gradient":
        if not data.itemName:
            raise HTTPException(status_code=400, detail="Введите название градиента")
        if len(data.itemName) > 20:
            raise HTTPException(status_code=400, detail="Название градиента не более 20 символов")
    elif data.itemType == "create_clan":
        if user.get("clan"):
            raise HTTPException(status_code=400, detail="У вас уже есть клан")
        if not data.itemName:
            raise HTTPException(status_code=400, detail="Введите название клана")
        if len(data.itemName) > 10:
            raise HTTPException(status_code=400, detail="Название клана не более 10 символов")
        additional_updates["clan"] = data.itemName
    elif data.itemType == "clan_category":
        if not user.get("clan"):
            raise HTTPException(status_code=400, detail="Сначала создайте клан")
        if user.get("clanCategory"):
            raise HTTPException(status_code=400, detail="У вас уже есть категория")
        additional_updates["clanCategory"] = True
    
    update_operation = {
        "$inc": {"coins": -price}
    }
    
    if additional_updates:
        update_operation["$set"] = additional_updates
    
    if data.itemType == "custom_role":
        update_operation["$push"] = {"roles": data.itemName}
    elif data.itemType == "custom_gradient":
        update_operation["$push"] = {"roleGradients": data.itemName}
    
    updated_user = await db.users.find_one_and_update(
        {
            "id": user["id"],
            "coins": {"$gte": price}
        },
        update_operation,
        return_document=True
    )
    
    if not updated_user:
        raise HTTPException(status_code=400, detail="Недостаточно монет или ошибка обновления")
    
    now = datetime.now(timezone.utc)
    purchase_record = {
        "item": item["name"],
        "itemName": data.itemName,
        "price": price,
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H:%M")
    }
    
    await db.users.update_one(
        {"id": user["id"]},
        {"$push": {"purchaseHistory": purchase_record}}
    )
    
    return {"success": True, "purchase": purchase_record, "newBalance": updated_user["coins"]}

@api_router.post("/transfer")
async def transfer_coins(data: TransferRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    await check_cooldown(user["id"], "transfer", 2)
    
    
    if data.toUsername.lower() == user["username"].lower():
        raise HTTPException(status_code=400, detail="Нельзя отправить монеты себе")
    
    is_creator = user["username"].lower() == "pseudotamine"
    is_admin = user.get("isAdmin", False)
    user_level = user.get("level", 1)
    
    if not is_creator and not is_admin and user_level < 10:
        raise HTTPException(
            status_code=403, 
            detail=f"Переводы доступны с 10 уровня. Ваш уровень: {user_level}"
        )
    
    recipient = await db.users.find_one({"username": {"$regex": f"^{data.toUsername}$", "$options": "i"}}, {"_id": 0})
    if not recipient:
        raise HTTPException(status_code=404, detail="Получатель не найден")
    
    sender_result = await db.users.find_one_and_update(
        {
            "id": user["id"],
            "coins": {"$gte": data.amount}
        },
        {"$inc": {"coins": -data.amount}},
        return_document=True
    )
    
    if not sender_result:
        raise HTTPException(status_code=400, detail="Недостаточно монет")
    
    await db.users.update_one(
        {"id": recipient["id"]},
        {"$inc": {"coins": data.amount}}
    )
    
    return {
        "success": True,
        "transferred": data.amount,
        "to": recipient["username"],
        "newBalance": sender_result["coins"]
    }

DAILY_BONUS = 50
WEEKLY_BONUS = 300

@api_router.post("/bonus/claim")
async def claim_bonus(data: BonusRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    if data.bonusType not in ["daily", "weekly"]:
        raise HTTPException(status_code=400, detail="Неверный тип бонуса")
    
    now = datetime.now(timezone.utc)
    
    if data.bonusType == "daily":
        last_claim = user.get("lastDailyBonus")
        if last_claim:
            last_time = datetime.fromisoformat(last_claim.replace("Z", "+00:00"))
            hours_since = (now - last_time).total_seconds() / 3600
            if hours_since < 24:
                hours_left = int(24 - hours_since)
                raise HTTPException(status_code=400, detail=f"Ежедневный бонус доступен через {hours_left} ч.")
        
        updated_user = await db.users.find_one_and_update(
            {"id": user["id"]},
            {
                "$inc": {"coins": DAILY_BONUS},
                "$set": {"lastDailyBonus": now.isoformat()}
            },
            return_document=True
        )
        return {"success": True, "bonusType": "daily", "amount": DAILY_BONUS, "newBalance": updated_user["coins"]}
    
    elif data.bonusType == "weekly":
        last_claim = user.get("lastWeeklyBonus")
        if last_claim:
            last_time = datetime.fromisoformat(last_claim.replace("Z", "+00:00"))
            days_since = (now - last_time).total_seconds() / 86400
            if days_since < 7:
                days_left = int(7 - days_since)
                raise HTTPException(status_code=400, detail=f"Еженедельный бонус доступен через {days_left} дн.")
        
        updated_user = await db.users.find_one_and_update(
            {"id": user["id"]},
            {
                "$inc": {"coins": WEEKLY_BONUS},
                "$set": {"lastWeeklyBonus": now.isoformat()}
            },
            return_document=True
        )
        return {"success": True, "bonusType": "weekly", "amount": WEEKLY_BONUS, "newBalance": updated_user["coins"]}

CHEST_REWARDS = {
    "common": {"min": 10, "max": 50},
    "rare": {"min": 50, "max": 150},
    "epic": {"min": 150, "max": 500}
}

@api_router.post("/chest/open")
async def open_chest(data: ChestRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    chests = user.get("chests", [])
    chest = next((c for c in chests if c["id"] == data.chestId), None)
    
    if not chest:
        raise HTTPException(status_code=404, detail="Сундук не найден")
    
    reward = CHEST_REWARDS.get(chest["type"], CHEST_REWARDS["common"])
    coins_won = random.randint(reward["min"], reward["max"])
    
    updated_user = await db.users.find_one_and_update(
        {"id": user["id"]},
        {
            "$inc": {"coins": coins_won},
            "$pull": {"chests": {"id": data.chestId}}
        },
        return_document=True
    )
    
    return {
        "success": True,
        "chestType": chest["type"],
        "coinsWon": coins_won,
        "newBalance": updated_user["coins"]
    }

@api_router.post("/admin/add-coins")
async def admin_add_coins(data: AdminAddCoins, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    old_coins = target.get("coins", 0)
    old_xp = target.get("xp", 0)
    old_level = target.get("level", 1)
    new_coins = old_coins + data.amount
    
    if data.amount <= 10000:
        await check_suspicious_activity(target["id"], old_coins, new_coins, old_xp, old_xp, old_level, old_level, from_admin=True, username=target.get("username"))
    else:
        await check_suspicious_activity(target["id"], old_coins, new_coins, old_xp, old_xp, old_level, old_level, from_admin=False, username=target.get("username"))
    
    await db.users.update_one(
        {"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}},
        {"$inc": {"coins": data.amount}}
    )
    
    return {"success": True, "addedCoins": data.amount, "toUser": target["username"], "newBalance": new_coins}

@api_router.post("/admin/remove-coins")
async def admin_remove_coins(data: AdminAddCoins, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    new_balance = max(0, target["coins"] - data.amount)
    actual_removed = target["coins"] - new_balance
    
    await db.users.update_one(
        {"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}},
        {"$set": {"coins": new_balance}}
    )
    
    return {"success": True, "removedCoins": actual_removed, "fromUser": target["username"], "newBalance": new_balance}

@api_router.post("/admin/delete-user")
async def admin_delete_user(data: AdminDeleteUser, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    if target["username"].lower() == "pseudotamine":
        raise HTTPException(status_code=403, detail="Невозможно удалить создателя проекта")
    
    if target.get("isAdmin", False):
        raise HTTPException(status_code=403, detail="Невозможно удалить администратора")
    
    result = await db.users.delete_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=500, detail="Ошибка при удалении")
    
    return {
        "success": True,
        "deletedUser": target["username"],
        "message": f"Пользователь {target['username']} полностью удалён"
    }

@api_router.post("/admin/set-level")
async def admin_set_level(data: AdminSetLevel, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    total_xp = 0
    xp_for_next = 100
    for lvl in range(1, data.level):
        total_xp += xp_for_next
        xp_for_next = int(xp_for_next * 1.15)
    
    old_coins = target.get("coins", 0)
    old_xp = target.get("xp", 0)
    old_level = target.get("level", 1)
    new_level = data.level
    await check_suspicious_activity(target["id"], old_coins, old_coins, old_xp, total_xp, old_level, new_level, from_admin=True, username=target.get("username"))
    
    xp_required_for_next = xp_for_next
    
    await db.users.update_one(
        {"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}},
        {"$set": {
            "level": data.level,
            "xp": total_xp
        }}
    )
    
    return {
        "success": True,
        "targetUser": target["username"],
        "newLevel": data.level,
        "totalXP": total_xp,
        "xpForNextLevel": xp_required_for_next,
        "message": f"Уровень {data.level} выдан пользователю {target['username']}"
    }

@api_router.get("/admin/users")
async def admin_get_users(user: dict = Depends(get_current_user), request: Request = None):
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    users = await db.users.find(
        {"$or": [{"approved": True}, {"isAdmin": True}, {"username": {"$regex": f"^{CREATOR_USERNAME}$", "$options": "i"}}]},
        {"_id": 0, "passwordHash": 0}
    ).to_list(1000)
    return users

class GiveChestRequest(BaseModel):
    targetUsername: str
    chestType: str

class BanUserRequest(BaseModel):
    targetUsername: str

class SetAdminRequest(BaseModel):
    targetUsername: str
    creatorPassword: str

@api_router.post("/admin/give-chest")
async def admin_give_chest(data: GiveChestRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    if data.chestType not in ["common", "rare", "epic"]:
        raise HTTPException(status_code=400, detail="Неверный тип сундука")
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    now = datetime.now(timezone.utc)
    chest = {
        "id": str(int(now.timestamp() * 1000)),
        "type": data.chestType,
        "droppedAt": now.isoformat()
    }
    
    await db.users.update_one(
        {"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}},
        {"$push": {"chests": chest}}
    )
    
    return {"success": True, "toUser": target["username"], "chestType": data.chestType}

CREATOR_USERNAME = "pseudotamine"
CREATOR_PASSWORD = os.environ.get('CREATOR_PASSWORD')
if not CREATOR_PASSWORD:
    if os.environ.get('ENVIRONMENT') == 'production':
        raise RuntimeError("CREATOR_PASSWORD must be set in production environment")
    CREATOR_PASSWORD = 'sukunaW_secret_key_2026'

@api_router.post("/admin/ban")
async def admin_ban_user(data: BanUserRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    if target["username"].lower() == CREATOR_USERNAME.lower():
        raise HTTPException(status_code=403, detail="Не пытайтесь забанить создателя!")
    
    if target.get("isBanned"):
        raise HTTPException(status_code=400, detail="Пользователь уже забанен")
    
    await db.users.update_one(
        {"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}},
        {"$set": {"isBanned": True}}
    )
    
    return {"success": True, "message": f"{target['username']} забанен"}

@api_router.post("/admin/unban")
async def admin_unban_user(data: BanUserRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    if not target.get("isBanned"):
        raise HTTPException(status_code=400, detail="Пользователь не забанен")
    
    await db.users.update_one(
        {"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}},
        {"$set": {"isBanned": False}}
    )
    
    return {"success": True, "message": f"{target['username']} разбанен"}

@api_router.post("/admin/set-admin")
async def admin_set_admin(data: SetAdminRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    if user["username"].lower() != CREATOR_USERNAME.lower():
        raise HTTPException(status_code=403, detail="Только создатель может назначать администраторов")
    
    if data.creatorPassword != CREATOR_PASSWORD:
        raise HTTPException(status_code=403, detail="Неверный пароль создателя")
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    if target["username"].lower() == CREATOR_USERNAME.lower():
        raise HTTPException(status_code=403, detail="Нельзя изменить статус создателя")
    
    if target.get("isBanned"):
        raise HTTPException(status_code=400, detail="Нельзя назначить забаненного пользователя")
    
    if target.get("isAdmin"):
        raise HTTPException(status_code=400, detail="Пользователь уже администратор")
    
    await db.users.update_one(
        {"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}},
        {"$set": {"isAdmin": True}}
    )
    
    return {"success": True, "message": f"{target['username']} назначен администратором"}

@api_router.post("/admin/remove-admin")
async def admin_remove_admin(data: SetAdminRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    if user["username"].lower() != CREATOR_USERNAME.lower():
        raise HTTPException(status_code=403, detail="Только создатель может снимать администраторов")
    
    if data.creatorPassword != CREATOR_PASSWORD:
        raise HTTPException(status_code=403, detail="Неверный пароль создателя")
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    if target["username"].lower() == CREATOR_USERNAME.lower():
        raise HTTPException(status_code=403, detail="Нельзя изменить статус создателя")
    
    if not target.get("isAdmin"):
        raise HTTPException(status_code=400, detail="Пользователь не является администратором")
    
    await db.users.update_one(
        {"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}},
        {"$set": {"isAdmin": False}}
    )
    
    return {"success": True, "message": f"{target['username']} больше не администратор"}

@api_router.get("/admin/is-creator")
async def admin_is_creator(user: dict = Depends(get_current_user), request: Request = None):
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    is_creator = user["username"].lower() == CREATOR_USERNAME.lower()
    return {"isCreator": is_creator}

class ApproveWinRequest(BaseModel):
    winId: str

@api_router.get("/admin/pending-wins")
async def admin_get_pending_wins(user: dict = Depends(get_current_user), request: Request = None):
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    pending = await db.pending_wins.find(
        {"status": "pending"},
        {"_id": 0}
    ).to_list(1000)
    return pending

@api_router.post("/admin/approve-win")
async def admin_approve_win(data: ApproveWinRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    win = await db.pending_wins.find_one({"id": data.winId, "status": "pending"}, {"_id": 0})
    if not win:
        raise HTTPException(status_code=404, detail="Выигрыш не найден")
    
    target = await db.users.find_one({"id": win["userId"]}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    coins_earned = win.get("coinsEarned", 0)
    xp_earned = win.get("xpEarned", 0)
    
    updated_user = await db.users.find_one_and_update(
        {"id": win["userId"]},
        {
            "$inc": {
                "coins": coins_earned,
                "xp": xp_earned
            }
        },
        return_document=True
    )
    
    new_level = calculate_level(updated_user["xp"])
    
    if new_level != updated_user.get("level", 1):
        await db.users.update_one(
            {"id": win["userId"]},
            {"$set": {"level": new_level}}
        )
    
    await db.pending_wins.update_one(
        {"id": data.winId},
        {"$set": {"status": "approved", "approvedAt": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {
        "success": True,
        "message": f"Выигрыш одобрен для {target['username']}",
        "coinsAwarded": coins_earned,
        "xpAwarded": xp_earned
    }

@api_router.post("/admin/reject-win")
async def admin_reject_win(data: ApproveWinRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    win = await db.pending_wins.find_one({"id": data.winId, "status": "pending"}, {"_id": 0})
    if not win:
        raise HTTPException(status_code=404, detail="Выигрыш не найден")
    
    await db.pending_wins.update_one(
        {"id": data.winId},
        {"$set": {"status": "rejected", "rejectedAt": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {
        "success": True,
        "message": f"Выигрыш отклонён"
    }

@api_router.get("/admin/pending-users")
async def admin_get_pending_users(user: dict = Depends(get_current_user), request: Request = None):
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    pending = await db.users.find(
        {"approved": False, "isAdmin": False, "loginAttempted": True},
        {"_id": 0, "passwordHash": 0}
    ).to_list(1000)
    return pending

class ApproveUserRequest(BaseModel):
    targetUsername: str

@api_router.post("/admin/approve-user")
async def admin_approve_user(data: ApproveUserRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    if target.get("approved"):
        raise HTTPException(status_code=400, detail="Пользователь уже одобрен")
    
    await db.users.update_one(
        {"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}},
        {"$set": {
            "approved": True,
            "coins": 0,
            "xp": 0,
            "level": 1
        }}
    )
    
    return {"success": True, "message": f"Пользователь {target['username']} одобрен"}

@api_router.delete("/admin/delete-pending")
async def admin_delete_pending(data: ApproveUserRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    await db.users.delete_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}})
    
    return {"success": True, "message": f"Пользователь {target['username']} удалён"}

@api_router.get("/health")
async def health():
    return {"status": "ok"}

@api_router.get("/leaderboard")
async def get_leaderboard(user: dict = Depends(get_current_user), request: Request = None):
    cursor = db.users.find(
        {"isAdmin": {"$ne": True}, "approved": True, "isBanned": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "coins": 1, "level": 1}
    ).sort("coins", -1).limit(50)
    
    leaders = await cursor.to_list(length=50)
    return leaders

class CrashGameRequest(BaseModel):
    betAmount: int = Field(ge=10, le=50000)

@api_router.post("/crash/play")
async def crash_play(data: CrashGameRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    await check_cooldown(user["id"], "crash_play", 1)
    
    is_creator = user["username"].lower() == CREATOR_USERNAME.lower()
    if not is_creator and not user.get("isAdmin", False) and not user.get("approved", False):
        raise HTTPException(status_code=403, detail="Ваш аккаунт ожидает одобрения администратора")
    
    
    if user.get("activeCrashGame"):
        start_time_str = user["activeCrashGame"].get("startTime")
        if start_time_str:
            start_time = datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
            time_elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
            
            if time_elapsed > 60:
                await db.users.update_one(
                    {"id": user["id"]},
                    {"$unset": {"activeCrashGame": ""}}
                )
            else:
                seconds_left = int(60 - time_elapsed)
                raise HTTPException(
                    status_code=400, 
                    detail=f"При предыдущей игре вы обновили страницу. Подождите {seconds_left} сек для новой игры во избежание абуза"
                )
    
    crash_time = round(random.uniform(1, 40), 2)
    
    rand = random.random()
    
    if rand < 0.40:
        win_rand = random.random()
        
        if win_rand < 0.70:
            crash_multiplier = round(random.uniform(1.0, 1.7), 2)
        elif win_rand < 0.90:
            crash_multiplier = round(random.uniform(1.7, 3.0), 2)
        elif win_rand < 0.98:
            crash_multiplier = round(random.uniform(3.0, 10.0), 2)
        else:
            crash_multiplier = round(random.uniform(10.0, 30.0), 2)
    else:
        crash_multiplier = round(random.uniform(0.2, 0.99), 2)
    
    if crash_multiplier == 1.0:
        winAmount = data.betAmount
        profit = 0
        won = None
    elif crash_multiplier > 1.0:
        winAmount = int(data.betAmount * crash_multiplier)
        profit = winAmount - data.betAmount
        won = True
    else:
        winAmount = 0
        profit = -data.betAmount
        won = False
    
    game_id = str(uuid.uuid4())
    
    updated_user = await db.users.find_one_and_update(
        {
            "id": user["id"],
            "coins": {"$gte": data.betAmount}
        },
        {
            "$inc": {"coins": -data.betAmount},
            "$set": {
                "activeCrashGame": {
                    "gameId": game_id,
                    "betAmount": data.betAmount,
                    "crashMultiplier": crash_multiplier,
                    "profit": profit,
                    "won": won,
                    "startTime": datetime.now(timezone.utc).isoformat()
                }
            }
        },
        return_document=True
    )
    
    if not updated_user:
        raise HTTPException(status_code=400, detail="Недостаточно монет")
    
    return {
        "success": True,
        "gameId": game_id,
        "crashMultiplier": crash_multiplier,
        "crashTime": crash_time,
        "betAmount": data.betAmount
    }

@api_router.post("/crash/complete")
async def crash_complete(user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    active_game = user.get("activeCrashGame")
    if not active_game:
        raise HTTPException(status_code=400, detail="Нет активной игры")
    
    bet_amount = active_game["betAmount"]
    profit = active_game["profit"]
    won = active_game.get("won")
    
    total_winnings = bet_amount + profit if won else 0
    
    if won and total_winnings > 5000:
        pending_win = {
            "id": str(uuid.uuid4()),
            "userId": user["id"],
            "username": user["username"],
            "gameType": "crash",
            "betAmount": bet_amount,
            "multiplier": active_game["crashMultiplier"],
            "coinsEarned": total_winnings,
            "xpEarned": 0,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "status": "pending"
        }
        await db.pending_wins.insert_one(pending_win)
        
        await db.users.update_one(
            {"id": user["id"]},
            {"$unset": {"activeCrashGame": ""}}
        )
        
        return {
            "pending": True,
            "message": "Ваш выигрыш на рассмотрении администрации, ожидайте начисления",
            "profit": total_winnings,
            "multiplier": active_game["crashMultiplier"]
        }
    
    new_balance = user.get("coins", 0) + bet_amount + profit
    
    await db.users.update_one(
        {"id": user["id"]},
        {
            "$inc": {"coins": bet_amount + profit},
            "$unset": {"activeCrashGame": ""}
        }
    )
    
    return {
        "success": True,
        "crashMultiplier": active_game["crashMultiplier"],
        "won": won,
        "betAmount": bet_amount,
        "winAmount": bet_amount + profit if won else 0,
        "profit": profit,
        "newBalance": new_balance
    }

class BuyChestRequest(BaseModel):
    chestType: str

@api_router.post("/shop/buy-chest")
async def shop_buy_chest(data: BuyChestRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    chest_prices = {
        "common": 85,
        "rare": 275,
        "epic": 700
    }
    
    if data.chestType not in chest_prices:
        raise HTTPException(status_code=400, detail="Неверный тип сундука")
    
    price = chest_prices[data.chestType]
    
    chest = {
        "id": str(uuid.uuid4()),
        "type": data.chestType,
        "droppedAt": datetime.now(timezone.utc).isoformat()
    }
    
    updated_user = await db.users.find_one_and_update(
        {
            "id": user["id"],
            "coins": {"$gte": price}
        },
        {
            "$inc": {"coins": -price},
            "$push": {"chests": chest}
        },
        return_document=True
    )
    
    if not updated_user:
        raise HTTPException(status_code=400, detail="Недостаточно монет")
    
    return {"success": True, "chest": chest, "newBalance": updated_user["coins"]}

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_event():
    
    try:
        await db.failed_logins.create_index(
            "timestamp",
            expireAfterSeconds=3600,
            name="failed_logins_ttl"
        )
        logger.info("TTL index created for failed_logins (1 hour)")
    except Exception as e:
        logger.info(f"TTL index for failed_logins already exists or error: {e}")
    
    try:
        await db.blocked_usernames.drop()
        logger.info("Dropped old blocked_usernames collection (no longer used)")
    except Exception:
        pass
    
    
    try:
        await db.users.create_index(
            [("username", 1)],
            unique=True,
            collation={"locale": "en", "strength": 2},
            name="username_unique"
        )
        logger.info("Unique index created for users.username")
    except Exception as e:
        logger.info(f"Username unique index already exists or error: {e}")
    
    admin = await db.users.find_one({"username": "pseudotamine"})
    if not admin:
        admin_password = os.environ.get('CREATOR_PASSWORD')
        admin_id = str(uuid.uuid4())
        admin_user = {
            "id": admin_id,
            "username": "pseudotamine",
            "passwordHash": hash_password(admin_password),
            "coins": 0,
            "level": 1,
            "xp": 0,
            "roles": ["Админ"],
            "roleGradients": [],
            "clan": None,
            "clanCategory": False,
            "purchaseHistory": [],
            "isAdmin": True,
            "isBanned": False,
            "approved": True,
            "lastGameTime": None,
            "lastDailyBonus": None,
            "lastWeeklyBonus": None,
            "chests": [],
            "createdAt": datetime.now(timezone.utc).isoformat()
        }
        await db.users.insert_one(admin_user)
        logger.info("Admin user 'pseudotamine' created")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
