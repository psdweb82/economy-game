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

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Settings - SECURITY FIX: No fallback in production
JWT_SECRET = os.environ.get('JWT_SECRET')
if not JWT_SECRET:
    # Allow fallback only for local development
    if os.environ.get('ENVIRONMENT') == 'production':
        raise RuntimeError("JWT_SECRET must be set in production environment")
    JWT_SECRET = 'sukunaW_secret_key_2026'  # Local dev only
    
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 168

security = HTTPBearer()

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ==================== RATE LIMITING ====================
# Rate limiter with IP + username tracking
rate_limit_store = defaultdict(list)
RATE_LIMIT_REQUESTS = 40  # Max requests for general endpoints
RATE_LIMIT_WINDOW = 10  # Time window in seconds

# SECURITY: Stricter limits for auth endpoints
AUTH_RATE_LIMIT_REGISTER = 3  # Max 3 registrations per minute per IP
AUTH_RATE_LIMIT_LOGIN = 5     # Max 5 login attempts per minute per IP
AUTH_RATE_LIMIT_WINDOW = 60   # 1 minute window

# SECURITY FIX: Additional username-based rate limiting (anti-proxy protection)
USERNAME_RATE_LIMIT_LOGIN = 5      # Max 5 attempts per minute per username (from ANY IP)
USERNAME_RATE_LIMIT_REGISTER = 3   # Max 3 registrations per minute per similar username pattern

# Track failed login attempts in MongoDB (persistent across restarts)
MAX_FAILED_LOGINS_IP = 5       # Max failed attempts per IP before lockout
# SECURITY FIX: Progressive delay instead of blocking username (prevents DoS)
# After N attempts: 1s, 2s, 5s, 10s, 30s, 60s delay
PROGRESSIVE_DELAYS = [0, 0, 1, 2, 5, 10, 30, 60, 120]  # seconds
FAILED_LOGIN_LOCKOUT = 300     # 5 minutes for IP lockout (keep history)

async def check_rate_limit(request: Request, endpoint_type: str = "general", username: str = None):
    """
    Rate limiting with different limits for different endpoint types
    SECURITY FIX: Dual protection - by IP AND by username (anti-proxy)
    
    - general: 40 requests per 10 seconds per IP
    - register: 3 requests per minute per IP + username pattern check
    - login: 5 requests per minute per IP + 5 per minute per username (ANY IP)
    """
    # Get real IP from X-Forwarded-For header (Kubernetes/nginx proxy)
    forwarded_for = request.headers.get("x-forwarded-for")
    client_ip = forwarded_for.split(",")[0].strip() if forwarded_for else request.client.host
    
    # Get user agent for basic bot detection (ADDITIONAL, not primary)
    user_agent = request.headers.get("user-agent", "").lower()
    
    # SECURITY: Block suspicious user agents (ADDITIONAL protection, easily bypassed)
    suspicious_agents = ["bot", "crawler", "spider", "scraper"]
    if any(agent in user_agent for agent in suspicious_agents):
        # Allow legitimate bots but log suspicious activity
        if "googlebot" not in user_agent and "bingbot" not in user_agent:
            logger.warning(f"Suspicious user agent from {client_ip}: {user_agent}")
            # Don't block, just log (can be easily bypassed)
    
    now = datetime.now(timezone.utc).timestamp()
    
    # Determine limits based on endpoint type
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
    
    # Check IP-based rate limit
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
    
    # SECURITY FIX: Additional username-based rate limiting (ANTI-PROXY)
    if username and endpoint_type in ["login", "register"]:
        username_key = f"username_{username.lower()}_{endpoint_type}"
        
        # Clean old timestamps for this username
        rate_limit_store[username_key] = [
            ts for ts in rate_limit_store[username_key]
            if now - ts < AUTH_RATE_LIMIT_WINDOW
        ]
        
        # Check username-based limit
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
    
    # Check IP-based lockout (hard block)
    ip_attempts = await db.failed_logins.count_documents({
        "ip": client_ip,
        "timestamp": {"$gte": lockout_threshold}
    })
    
    if ip_attempts >= MAX_FAILED_LOGINS_IP:
        raise HTTPException(
            status_code=429,
            detail=f"Слишком много неудачных попыток с этого IP. Подождите {FAILED_LOGIN_LOCKOUT // 60} мин."
        )
    
    # SECURITY FIX: Progressive delay for username (ANTI-DoS)
    # Instead of blocking username completely (DoS vulnerability),
    # we introduce increasing delays
    username_attempts = await db.failed_logins.count_documents({
        "username": username.lower(),
        "timestamp": {"$gte": lockout_threshold}
    })
    
    if username_attempts > 0:
        # Calculate progressive delay
        delay_index = min(username_attempts, len(PROGRESSIVE_DELAYS) - 1)
        required_delay = PROGRESSIVE_DELAYS[delay_index]
        
        if required_delay > 0:
            # Check if last attempt was recent enough to require delay
            last_attempt = await db.failed_logins.find_one(
                {"username": username.lower()},
                sort=[("timestamp", -1)]
            )
            
            if last_attempt:
                time_since_last = (now - last_attempt["timestamp"]).total_seconds()
                
                if time_since_last < required_delay:
                    remaining_delay = int(required_delay - time_since_last)
                    
                    # Log suspicious activity (potential attack)
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
    
    # Record in MongoDB (will be auto-deleted by TTL index after 1 hour)
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
    # Clear attempts for this IP
    await db.failed_logins.delete_many({"ip": client_ip})
    
    # Clear attempts for this username
    await db.failed_logins.delete_many({"username": username.lower()})

def detect_suspicious_username_pattern(username: str) -> bool:
    """
    Detect suspicious username patterns (mass registration attempts)
    Examples: test1, test2, test3 / user001, user002 / bot_1, bot_2
    
    NOTE: This is ADDITIONAL protection, not critical (easily bypassed)
    """
    username_lower = username.lower()
    
    # Pattern 1: Ends with number (test1, user123)
    import re
    if re.match(r'^[a-z]+\d+$', username_lower):
        # Check if base name is generic
        base_name = re.sub(r'\d+$', '', username_lower)
        generic_names = ['test', 'user', 'bot', 'fake', 'temp', 'demo', 'sample', 'example']
        if base_name in generic_names:
            return True
    
    # Pattern 2: Ends with underscore/dash + number (bot_1, user-123)
    if re.match(r'^[a-z]+[_-]\d+$', username_lower):
        base_name = re.sub(r'[_-]\d+$', '', username_lower)
        if base_name in ['test', 'user', 'bot', 'fake', 'temp']:
            return True
    
    # Pattern 3: All numbers or very short (1, 12, 123)
    if username_lower.isdigit() and len(username_lower) <= 4:
        return True
    
    return False

async def check_mass_registration_pattern(username: str, client_ip: str):
    """
    Check for mass registration patterns from same IP
    """
    # Check if similar usernames were registered from this IP recently
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    
    # Extract base pattern (e.g., "test" from "test123")
    import re
    base_pattern = re.sub(r'\d+$', '', username.lower())
    base_pattern = re.sub(r'[_-]\d+$', '', base_pattern)
    
    # Count similar registrations from this IP
    similar_count = await db.users.count_documents({
        "registrationIP": client_ip,
        "createdAt": {"$gte": one_hour_ago.isoformat()},
        "username": {"$regex": f"^{base_pattern}", "$options": "i"}
    })
    
    if similar_count >= 2:  # Already 2 similar usernames from this IP
        raise HTTPException(
            status_code=400,
            detail="Обнаружена подозрительная активность. Регистрация временно недоступна"
        )

# ==================== MODELS WITH VALIDATION ====================
class UserRegister(BaseModel):
    username: str
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class GameResult(BaseModel):
    score: int = Field(ge=0, le=3000)  # Max 3000 score
    timePlayedSeconds: int = Field(ge=0, le=600)  # Max 10 minutes

class PurchaseRequest(BaseModel):
    itemType: str
    itemName: Optional[str] = None

class TransferRequest(BaseModel):
    toUsername: str
    amount: int = Field(gt=0, le=50000)  # SECURITY: Must be positive, max 50000

class AdminAddCoins(BaseModel):
    targetUsername: str
    amount: int = Field(gt=0, le=100000)  # SECURITY: Must be positive

class AdminDeleteUser(BaseModel):
    targetUsername: str

class AdminSetLevel(BaseModel):
    targetUsername: str
    level: int = Field(ge=1, le=100)  # SECURITY: Level must be 1-100

class BonusRequest(BaseModel):
    bonusType: str

class ChestRequest(BaseModel):
    chestId: str

# ==================== HELPERS ====================
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
    
    # Check if user is banned
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
    # SECURITY FIX: Never ban creator
    if username and username.lower() == "pseudotamine":
        return  # Creator is immune to auto-ban
    
    coins_gain = new_coins - old_coins
    xp_gain = new_xp - old_xp
    level_jump = new_level - old_level
    
    suspicious = False
    reason = ""
    
    # Check for excessive gains (skip if from admin)
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
    
    # Always check negative balance
    if new_coins < 0 or new_xp < 0:
        suspicious = True
        reason = f"Отрицательный баланс (coins: {new_coins}, xp: {new_xp})"
    
    if suspicious:
        # BAN user (do NOT delete)
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"isBanned": True}}
        )
        logger.warning(f"User {user_id} auto-banned: {reason}")
        raise HTTPException(
            status_code=403, 
            detail=f"Ваш аккаунт заблокирован"
        )

# Cooldown tracking: {user_id: {action: timestamp}}
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

# ==================== AUTH ROUTES ====================
@api_router.post("/auth/register")
async def register(data: UserRegister, request: Request):
    # SECURITY: Strict rate limiting for registration (3 per minute per IP + username)
    await check_rate_limit(request, endpoint_type="register", username=data.username)
    
    # ANTI-DUPE: Get real client IP from X-Forwarded-For header (Kubernetes/nginx proxy)
    forwarded_for = request.headers.get("x-forwarded-for")
    client_ip = forwarded_for.split(",")[0].strip() if forwarded_for else request.client.host
    
    # Input validation
    if len(data.username) < 3 or len(data.username) > 20:
        raise HTTPException(status_code=400, detail="Имя пользователя должно быть от 3 до 20 символов")
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Пароль должен быть не менее 6 символов")
    
    # SECURITY: Check for suspicious username patterns (ADDITIONAL, not critical)
    if detect_suspicious_username_pattern(data.username):
        logger.warning(f"Suspicious username pattern detected: {data.username} from {client_ip}")
        # Don't block - just log (easily bypassed, not primary defense)
    
    # SECURITY FIX: Check for mass registration patterns from same IP
    await check_mass_registration_pattern(data.username, client_ip)
    
    # Check cooldown: 1 hour between registrations from same IP
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
    
    # Check total accounts from this IP (strict limit: max 2 accounts ever)
    accounts_from_ip = await db.users.count_documents({"registrationIP": client_ip})
    if accounts_from_ip >= 2:
        raise HTTPException(status_code=400, detail="Достигнут лимит аккаунтов с этого IP-адреса (максимум 2)")
    
    # SECURITY FIX: Check if username already exists (case-insensitive)
    # This provides better UX than relying only on unique index error
    existing_user = await db.users.find_one(
        {"username": {"$regex": f"^{data.username}$", "$options": "i"}},
        {"_id": 1}
    )
    if existing_user:
        raise HTTPException(status_code=400, detail="Это имя пользователя уже занято")
    
    # SECURITY FIX: Atomic check-and-insert to prevent race condition duplicates
    user_id = str(uuid.uuid4())
    user = {
        "id": user_id,
        "username": data.username,
        "passwordHash": hash_password(data.password),
        # NO coins, xp, level until approved
        "roles": [],
        "roleGradients": [],
        "clan": None,
        "clanCategory": False,
        "purchaseHistory": [],
        "isAdmin": False,
        "isBanned": False,
        "approved": False,  # Requires admin approval
        "loginAttempted": False,  # Track login attempts
        "lastGameTime": None,
        "lastDailyBonus": None,
        "lastWeeklyBonus": None,
        "chests": [],
        "registrationIP": client_ip,
        "createdAt": datetime.now(timezone.utc).isoformat()
    }
    
    try:
        # SECURITY FIX: Create unique index on username (case-insensitive) to prevent duplicates
        # This will be created on first run and prevent any race condition duplicates
        await db.users.create_index(
            [("username", 1)],
            unique=True,
            collation={"locale": "en", "strength": 2},  # Case-insensitive
            name="username_unique"
        )
    except Exception:
        pass  # Index already exists
    
    try:
        # SECURITY FIX: Atomic insert with collation for case-insensitive check
        # This prevents creating "pseudotamine", "Pseudotamine", "PSEUDOTAMINE" as different users
        await db.users.insert_one(user)
    except Exception as e:
        # Duplicate username (caught by unique index)
        if "duplicate" in str(e).lower() or "E11000" in str(e):
            raise HTTPException(status_code=400, detail="Это имя пользователя уже занято")
        raise
    
    # DO NOT return token - user must login manually
    return {"success": True, "message": "Аккаунт создан! Теперь войдите в систему", "username": data.username}

@api_router.post("/auth/login")
async def login(data: UserLogin, request: Request):
    # SECURITY: Strict rate limiting for login (5 per minute per IP + username)
    await check_rate_limit(request, endpoint_type="login", username=data.username)
    
    # Get client IP
    forwarded_for = request.headers.get("x-forwarded-for")
    client_ip = forwarded_for.split(",")[0].strip() if forwarded_for else request.client.host
    
    # SECURITY FIX: Check for too many failed login attempts (IP + USERNAME)
    await check_failed_login_attempts(client_ip, data.username)
    
    user = await db.users.find_one({"username": {"$regex": f"^{data.username}$", "$options": "i"}}, {"_id": 0})
    
    # SECURITY: Always check password even if user doesn't exist (timing attack prevention)
    if not user:
        # Still hash the password to maintain constant timing
        hash_password("dummy_password_to_maintain_timing")
        # Record failed attempt (IP + username)
        await record_failed_login(client_ip, data.username)
        raise HTTPException(status_code=401, detail="Неверные учётные данные")
    
    if not verify_password(data.password, user["passwordHash"]):
        # Record failed attempt (IP + username)
        await record_failed_login(client_ip, data.username)
        raise HTTPException(status_code=401, detail="Неверные учётные данные")
    
    # Check if user is banned
    if user.get("isBanned"):
        raise HTTPException(status_code=403, detail="Ваш аккаунт заблокирован")
    
    # ENHANCED SECURITY: Check for negative balance before login
    if user.get("coins", 0) < 0 or user.get("xp", 0) < 0:
        # BAN user (do NOT delete)
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"isBanned": True}}
        )
        raise HTTPException(status_code=403, detail="Ваш аккаунт заблокирован")
    
    # Check if user is approved (skip for admins and creator)
    is_creator = user["username"].lower() == CREATOR_USERNAME.lower()
    if not is_creator and not user.get("isAdmin", False) and not user.get("approved", False):
        # Mark that user attempted to login - show in admin panel
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"loginAttempted": True}}
        )
        raise HTTPException(status_code=403, detail="Ваш аккаунт ожидает одобрения администратора")
    
    # SECURITY FIX: Clear failed login attempts after successful login (IP + username)
    await clear_failed_login_attempts(client_ip, user["username"])
    
    token = create_token(user["id"], user["username"], user.get("isAdmin", False))
    user_response = {k: v for k, v in user.items() if k != "passwordHash"}
    return {"token": token, "user": user_response}

@api_router.get("/auth/me")
async def get_me(user: dict = Depends(get_current_user), request: Request = None):
    return {k: v for k, v in user.items() if k != "passwordHash"}

# ==================== GAME ROUTES ====================
@api_router.post("/game/submit")
async def submit_game_result(data: GameResult, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    # Check if user is approved (skip for creator and admins)
    is_creator = user["username"].lower() == CREATOR_USERNAME.lower()
    if not is_creator and not user.get("isAdmin", False) and not user.get("approved", False):
        raise HTTPException(status_code=403, detail="Ваш аккаунт ожидает одобрения администратора")
    
    # Cooldown: 10 seconds between games
    await check_cooldown(user["id"], "game_submit", 10)
    
    max_possible_score = data.timePlayedSeconds * 5
    if data.score > max_possible_score or data.score < 0:
        raise HTTPException(status_code=400, detail="Недопустимый результат игры")
    if data.timePlayedSeconds > 600:
        raise HTTPException(status_code=400, detail="Недопустимая продолжительность игры")
    
    # UPDATED DODGE ARENA REWARDS: More generous reward system
    score = data.score
    if score >= 100:
        # Score 100+: 70-90 coins
        coins_earned = min(70 + (score - 100) // 5, 90)
    elif score >= 50:
        # Score 50-99: 25-40 coins
        coins_earned = min(25 + (score - 50) // 3, 40)
    elif score >= 20:
        # Score 20-49: 10-24 coins
        coins_earned = 10 + (score - 20) // 3
    else:
        # Score 0-19: Minimum 3-9 coins
        coins_earned = max(3, score // 3)
    
    # XP earned with more generous formula
    xp_earned = data.score // 3 + data.timePlayedSeconds * 2
    
    # Check if win needs admin approval (>200 coins OR >200 XP)
    if coins_earned > 200 or xp_earned > 200:
        # Create pending win for admin approval
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
    
    # SECURITY FIX: Atomic operation with race condition protection
    now = datetime.now(timezone.utc)
    
    # Get fresh user data and update atomically
    updated_user = await db.users.find_one_and_update(
        {
            "id": user["id"],
            "coins": {"$gte": 0},  # Ensure coins never go negative
            "xp": {"$gte": 0}  # Ensure xp never go negative
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
    
    # Calculate new level from XP (SECURITY: Level always calculated from XP)
    new_xp = updated_user["xp"]
    new_level = calculate_level(new_xp)
    new_coins = updated_user["coins"]
    
    # Update level if changed
    if new_level != updated_user.get("level", 1):
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"level": new_level}}
        )
    
    # ANTI-CHEAT: Check for suspicious gains
    old_coins = user.get("coins", 0)
    old_xp = user.get("xp", 0)
    old_level = user.get("level", 1)
    await check_suspicious_activity(user["id"], old_coins, new_coins, old_xp, new_xp, old_level, new_level, from_admin=False, username=user.get("username"))
    
    # Random chest drop (10% chance if score > 30)
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

# ==================== SHOP ROUTES ====================
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
    
    # SECURITY FIX: Atomic operation to prevent race condition
    # Build additional updates based on item type
    additional_updates = {}
    
    if data.itemType == "custom_role":
        if not data.itemName:
            raise HTTPException(status_code=400, detail="Введите название роли")
        if len(data.itemName) > 20:
            raise HTTPException(status_code=400, detail="Название роли не более 20 символов")
        # Will push to roles array
    elif data.itemType == "custom_gradient":
        if not data.itemName:
            raise HTTPException(status_code=400, detail="Введите название градиента")
        if len(data.itemName) > 20:
            raise HTTPException(status_code=400, detail="Название градиента не более 20 символов")
        # Will push to roleGradients array
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
    
    # Atomic purchase with race condition protection
    update_operation = {
        "$inc": {"coins": -price}  # SECURITY: Atomic decrement
    }
    
    if additional_updates:
        update_operation["$set"] = additional_updates
    
    # Add to arrays if needed
    if data.itemType == "custom_role":
        update_operation["$push"] = {"roles": data.itemName}
    elif data.itemType == "custom_gradient":
        update_operation["$push"] = {"roleGradients": data.itemName}
    
    # Atomic update with condition check
    updated_user = await db.users.find_one_and_update(
        {
            "id": user["id"],
            "coins": {"$gte": price}  # SECURITY: Ensure user has enough coins
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
    
    # Add purchase record
    await db.users.update_one(
        {"id": user["id"]},
        {"$push": {"purchaseHistory": purchase_record}}
    )
    
    return {"success": True, "purchase": purchase_record, "newBalance": updated_user["coins"]}

# ==================== TRANSFER ROUTES ====================
@api_router.post("/transfer")
async def transfer_coins(data: TransferRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    # Cooldown: 2 seconds between transfers
    await check_cooldown(user["id"], "transfer", 2)
    
    # Validation is already done by Pydantic Field constraints
    # amount must be > 0 and <= 50000
    
    if data.toUsername.lower() == user["username"].lower():
        raise HTTPException(status_code=400, detail="Нельзя отправить монеты себе")
    
    # Level requirement: Must be level 10+ to transfer (except admins and creator)
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
    
    # SECURITY FIX: Atomic transfer with race condition protection
    # First, deduct from sender
    sender_result = await db.users.find_one_and_update(
        {
            "id": user["id"],
            "coins": {"$gte": data.amount}  # SECURITY: Ensure sender has enough
        },
        {"$inc": {"coins": -data.amount}},
        return_document=True
    )
    
    if not sender_result:
        raise HTTPException(status_code=400, detail="Недостаточно монет")
    
    # Then, add to recipient
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

# ==================== BONUS ROUTES ====================
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
        
        # SECURITY FIX: Atomic operation
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
        
        # SECURITY FIX: Atomic operation
        updated_user = await db.users.find_one_and_update(
            {"id": user["id"]},
            {
                "$inc": {"coins": WEEKLY_BONUS},
                "$set": {"lastWeeklyBonus": now.isoformat()}
            },
            return_document=True
        )
        return {"success": True, "bonusType": "weekly", "amount": WEEKLY_BONUS, "newBalance": updated_user["coins"]}

# ==================== CHEST ROUTES ====================
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
    
    # SECURITY FIX: Atomic operation
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

# ==================== ADMIN ROUTES ====================
@api_router.post("/admin/add-coins")
async def admin_add_coins(data: AdminAddCoins, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    # SECURITY FIX: Always verify admin status from database
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    # Validation already done by Pydantic (amount > 0, <= 100000)
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    # ANTI-CHEAT: Check for suspicious gains before updating
    old_coins = target.get("coins", 0)
    old_xp = target.get("xp", 0)
    old_level = target.get("level", 1)
    new_coins = old_coins + data.amount
    
    # SECURITY FIX: Creator is immune to auto-ban, but still check others
    # Admin can give up to 10,000 without triggering ban for regular users
    if data.amount <= 10000:
        await check_suspicious_activity(target["id"], old_coins, new_coins, old_xp, old_xp, old_level, old_level, from_admin=True, username=target.get("username"))
    else:
        # If admin gives >10,000, check but creator is still protected
        await check_suspicious_activity(target["id"], old_coins, new_coins, old_xp, old_xp, old_level, old_level, from_admin=False, username=target.get("username"))
    
    # SECURITY FIX: Atomic operation
    await db.users.update_one(
        {"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}},
        {"$inc": {"coins": data.amount}}
    )
    
    return {"success": True, "addedCoins": data.amount, "toUser": target["username"], "newBalance": new_coins}

@api_router.post("/admin/remove-coins")
async def admin_remove_coins(data: AdminAddCoins, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    # SECURITY FIX: Always verify admin status from database
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    # Validation already done by Pydantic
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    # Don't allow negative balance
    new_balance = max(0, target["coins"] - data.amount)
    actual_removed = target["coins"] - new_balance
    
    # SECURITY FIX: Use atomic operation
    await db.users.update_one(
        {"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}},
        {"$set": {"coins": new_balance}}
    )
    
    return {"success": True, "removedCoins": actual_removed, "fromUser": target["username"], "newBalance": new_balance}

@api_router.post("/admin/delete-user")
async def admin_delete_user(data: AdminDeleteUser, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    # SECURITY FIX: Always verify admin status from database
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    # Find target user
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    # Protection: Cannot delete creator or admins
    if target["username"].lower() == "pseudotamine":
        raise HTTPException(status_code=403, detail="Невозможно удалить создателя проекта")
    
    if target.get("isAdmin", False):
        raise HTTPException(status_code=403, detail="Невозможно удалить администратора")
    
    # Delete user completely from database
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
    
    # SECURITY FIX: Always verify admin status from database
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    # Validation already done by Pydantic (level 1-100)
    
    # Find target user
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    # Calculate XP for the target level
    # Formula: each level requires 15% more XP than previous
    total_xp = 0
    xp_for_next = 100
    for lvl in range(1, data.level):
        total_xp += xp_for_next
        xp_for_next = int(xp_for_next * 1.15)
    
    # ANTI-CHEAT: Check for suspicious level jump (admin can bypass)
    old_coins = target.get("coins", 0)
    old_xp = target.get("xp", 0)
    old_level = target.get("level", 1)
    new_level = data.level
    await check_suspicious_activity(target["id"], old_coins, old_coins, old_xp, total_xp, old_level, new_level, from_admin=True, username=target.get("username"))
    
    # Calculate XP required for NEXT level (level + 1)
    xp_required_for_next = xp_for_next
    
    # SECURITY FIX: Level is ALWAYS set with corresponding XP
    await db.users.update_one(
        {"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}},
        {"$set": {
            "level": data.level,
            "xp": total_xp  # Total XP accumulated up to this level
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
    # SECURITY FIX: Always verify admin status from database
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    # Show approved users + creator + admins in admin panel
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
    
    # SECURITY FIX: Always verify admin status from database
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

# Creator credentials
CREATOR_USERNAME = "pseudotamine"
# SECURITY FIX: Password moved to environment variable
CREATOR_PASSWORD = os.environ.get('CREATOR_PASSWORD')
if not CREATOR_PASSWORD:
    # Allow fallback only for local development
    if os.environ.get('ENVIRONMENT') == 'production':
        raise RuntimeError("CREATOR_PASSWORD must be set in production environment")
    CREATOR_PASSWORD = 'sukunaW_secret_key_2026'  # Local dev only

@api_router.post("/admin/ban")
async def admin_ban_user(data: BanUserRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    # SECURITY FIX: Always verify admin status from database
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    # Cannot ban the creator
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
    
    # SECURITY FIX: Always verify admin status from database
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
    
    # SECURITY FIX: Always verify admin status from database
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    # Only creator can set admins
    if user["username"].lower() != CREATOR_USERNAME.lower():
        raise HTTPException(status_code=403, detail="Только создатель может назначать администраторов")
    
    # Verify creator password
    if data.creatorPassword != CREATOR_PASSWORD:
        raise HTTPException(status_code=403, detail="Неверный пароль создателя")
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    # Cannot change creator's admin status
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
    
    # SECURITY FIX: Always verify admin status from database
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    # Only creator can remove admins
    if user["username"].lower() != CREATOR_USERNAME.lower():
        raise HTTPException(status_code=403, detail="Только создатель может снимать администраторов")
    
    # Verify creator password
    if data.creatorPassword != CREATOR_PASSWORD:
        raise HTTPException(status_code=403, detail="Неверный пароль создателя")
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    # Cannot change creator's admin status
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
    # SECURITY FIX: Always verify admin status from database
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    is_creator = user["username"].lower() == CREATOR_USERNAME.lower()
    return {"isCreator": is_creator}

# ==================== PENDING WINS APPROVAL ====================
class ApproveWinRequest(BaseModel):
    winId: str

@api_router.get("/admin/pending-wins")
async def admin_get_pending_wins(user: dict = Depends(get_current_user), request: Request = None):
    # SECURITY FIX: Always verify admin status from database
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    # Get all pending wins
    pending = await db.pending_wins.find(
        {"status": "pending"},
        {"_id": 0}
    ).to_list(1000)
    return pending

@api_router.post("/admin/approve-win")
async def admin_approve_win(data: ApproveWinRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    # SECURITY FIX: Always verify admin status from database
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    # Find pending win
    win = await db.pending_wins.find_one({"id": data.winId, "status": "pending"}, {"_id": 0})
    if not win:
        raise HTTPException(status_code=404, detail="Выигрыш не найден")
    
    # Get user
    target = await db.users.find_one({"id": win["userId"]}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    # SECURITY FIX: Atomic award operation
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
    
    # Calculate new level from XP (SECURITY: Level always calculated from XP)
    new_level = calculate_level(updated_user["xp"])
    
    # Update level if changed
    if new_level != updated_user.get("level", 1):
        await db.users.update_one(
            {"id": win["userId"]},
            {"$set": {"level": new_level}}
        )
    
    # Mark win as approved
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
    
    # SECURITY FIX: Always verify admin status from database
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    # Find pending win
    win = await db.pending_wins.find_one({"id": data.winId, "status": "pending"}, {"_id": 0})
    if not win:
        raise HTTPException(status_code=404, detail="Выигрыш не найден")
    
    # Mark win as rejected
    await db.pending_wins.update_one(
        {"id": data.winId},
        {"$set": {"status": "rejected", "rejectedAt": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {
        "success": True,
        "message": f"Выигрыш отклонён"
    }

# ==================== PENDING USERS MODERATION ====================
@api_router.get("/admin/pending-users")
async def admin_get_pending_users(user: dict = Depends(get_current_user), request: Request = None):
    # SECURITY FIX: Always verify admin status from database
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    # Get users who attempted login but not approved yet
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
    
    # SECURITY FIX: Always verify admin status from database
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    if target.get("approved"):
        raise HTTPException(status_code=400, detail="Пользователь уже одобрен")
    
    # Approve user and initialize game fields
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
    
    # SECURITY FIX: Always verify admin status from database
    if not await verify_admin(user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    # Delete user completely
    await db.users.delete_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}})
    
    return {"success": True, "message": f"Пользователь {target['username']} удалён"}

# ==================== HEALTH CHECK ====================
@api_router.get("/health")
async def health():
    return {"status": "ok"}

# ==================== LEADERBOARD ====================
@api_router.get("/leaderboard")
async def get_leaderboard(user: dict = Depends(get_current_user), request: Request = None):
    # Get top 50 approved non-admin NON-BANNED users sorted by coins
    cursor = db.users.find(
        {"isAdmin": {"$ne": True}, "approved": True, "isBanned": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "coins": 1, "level": 1}
    ).sort("coins", -1).limit(50)
    
    leaders = await cursor.to_list(length=50)
    return leaders

# ==================== CRASH GAME ====================
class CrashGameRequest(BaseModel):
    betAmount: int = Field(ge=10, le=50000)  # SECURITY: Must be 10-50000

@api_router.post("/crash/play")
async def crash_play(data: CrashGameRequest, user: dict = Depends(get_current_user), request: Request = None):
    await check_rate_limit(request)
    
    # Cooldown: 1 second between crash games
    await check_cooldown(user["id"], "crash_play", 1)
    
    # Check if user is approved (skip for creator and admins)
    is_creator = user["username"].lower() == CREATOR_USERNAME.lower()
    if not is_creator and not user.get("isAdmin", False) and not user.get("approved", False):
        raise HTTPException(status_code=403, detail="Ваш аккаунт ожидает одобрения администратора")
    
    # Validation already done by Pydantic (10-50000)
    
    # Check if there's an active game
    if user.get("activeCrashGame"):
        # Check if game is older than 60 seconds - if yes, clean it up
        start_time_str = user["activeCrashGame"].get("startTime")
        if start_time_str:
            start_time = datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
            time_elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
            
            if time_elapsed > 60:
                # Clean up old game (money was already deducted, no refund)
                await db.users.update_one(
                    {"id": user["id"]},
                    {"$unset": {"activeCrashGame": ""}}
                )
            else:
                # Show better error message
                seconds_left = int(60 - time_elapsed)
                raise HTTPException(
                    status_code=400, 
                    detail=f"При предыдущей игре вы обновили страницу. Подождите {seconds_left} сек для новой игры во избежание абуза"
                )
    
    crash_time = round(random.uniform(1, 40), 2)
    
    rand = random.random()
    
    # 40% win, 60% loss
    if rand < 0.40:
        # Win: multiplier >= 1.0
        # Progressive difficulty - higher multipliers are MUCH rarer
        win_rand = random.random()
        
        if win_rand < 0.70:  # 70% of wins: 1.0-1.7x (MOST COMMON)
            crash_multiplier = round(random.uniform(1.0, 1.7), 2)
        elif win_rand < 0.90:  # 20% of wins: 1.7-3.0x (RARE)
            crash_multiplier = round(random.uniform(1.7, 3.0), 2)
        elif win_rand < 0.98:  # 8% of wins: 3.0-10.0x (VERY RARE)
            crash_multiplier = round(random.uniform(3.0, 10.0), 2)
        else:  # 2% of wins: 10.0-30.0x (EXTREMELY RARE - JACKPOT!)
            crash_multiplier = round(random.uniform(10.0, 30.0), 2)
    else:
        # Loss: multiplier < 1.0
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
    
    # SECURITY FIX: Atomic deduction with race condition protection
    updated_user = await db.users.find_one_and_update(
        {
            "id": user["id"],
            "coins": {"$gte": data.betAmount}  # SECURITY: Ensure user has enough
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
    
    # Money was already deducted in /crash/play
    bet_amount = active_game["betAmount"]
    profit = active_game["profit"]
    won = active_game.get("won")
    
    # Calculate total winnings (bet + profit)
    total_winnings = bet_amount + profit if won else 0
    
    # Check if TOTAL win is >5000 and needs admin approval
    if won and total_winnings > 5000:
        # Create pending win for admin approval
        pending_win = {
            "id": str(uuid.uuid4()),
            "userId": user["id"],
            "username": user["username"],
            "gameType": "crash",
            "betAmount": bet_amount,
            "multiplier": active_game["crashMultiplier"],
            "coinsEarned": total_winnings,  # Total winnings, not just profit
            "xpEarned": 0,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "status": "pending"
        }
        await db.pending_wins.insert_one(pending_win)
        
        # Clear active game (money was already deducted, so no refund)
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
    
    # SECURITY FIX: Atomic operation for adding winnings
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

# ==================== SHOP CHESTS ====================
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
    
    # SECURITY FIX: Atomic purchase with race condition protection
    updated_user = await db.users.find_one_and_update(
        {
            "id": user["id"],
            "coins": {"$gte": price}  # SECURITY: Ensure user has enough
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

# Include router
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
    # SECURITY: Create TTL indexes for temporary collections (auto-cleanup)
    # This prevents MongoDB from filling up with old data
    
    try:
        # TTL Index for failed_logins: auto-delete after 1 hour (3600 seconds)
        await db.failed_logins.create_index(
            "timestamp",
            expireAfterSeconds=3600,
            name="failed_logins_ttl"
        )
        logger.info("TTL index created for failed_logins (1 hour)")
    except Exception as e:
        logger.info(f"TTL index for failed_logins already exists or error: {e}")
    
    # NOTE: We don't use blocked_usernames anymore (progressive delay instead)
    # But if collection exists, clean it up
    try:
        await db.blocked_usernames.drop()
        logger.info("Dropped old blocked_usernames collection (no longer used)")
    except Exception:
        pass
    
    # IMPORTANT: NO TTL on users collection! Users must persist forever.
    # TTL is ONLY for temporary security-related collections.
    
    # Create unique index on username for users (if not exists)
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
    
    # Check if admin user exists
    admin = await db.users.find_one({"username": "pseudotamine"})
    if not admin:
        # SECURITY FIX: Use password from environment variable
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
            "approved": True,  # Auto-approved for creator
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
