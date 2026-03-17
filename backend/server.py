from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt
import random

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Settings
JWT_SECRET = os.environ.get('JWT_SECRET', 'sukunaW_secret_key_2026')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 168

security = HTTPBearer()

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ==================== MODELS ====================
class UserRegister(BaseModel):
    username: str
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class GameResult(BaseModel):
    score: int
    timePlayedSeconds: int

class PurchaseRequest(BaseModel):
    itemType: str
    itemName: Optional[str] = None

class TransferRequest(BaseModel):
    toUsername: str
    amount: int

class AdminAddCoins(BaseModel):
    targetUsername: str
    amount: int

class AdminDeleteUser(BaseModel):
    targetUsername: str

class AdminSetLevel(BaseModel):
    targetUsername: str
    level: int

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

def calculate_level(xp: int) -> int:
    level = 1
    xp_for_next = 100
    remaining_xp = xp
    while remaining_xp >= xp_for_next and level < 100:
        remaining_xp -= xp_for_next
        level += 1
        xp_for_next = int(xp_for_next * 1.15)
    return level

async def check_suspicious_activity(user_id: str, old_coins: int, new_coins: int, old_xp: int, new_xp: int, old_level: int, new_level: int, from_admin: bool = False):
    """
    Auto-ban for suspicious gains:
    - Coins gain >5000 at once (unless from admin)
    - XP gain >1000 at once (unless from admin)
    - Level jump >5 at once (unless from admin)
    - Negative balance (always ban)
    """
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


# ==================== AUTH ROUTES ====================
@api_router.post("/auth/register")
async def register(data: UserRegister, request: Request):
    # ANTI-DUPE: Get real client IP from X-Forwarded-For header (Kubernetes/nginx proxy)
    forwarded_for = request.headers.get("x-forwarded-for")
    client_ip = forwarded_for.split(",")[0].strip() if forwarded_for else request.client.host
    
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
    
    existing = await db.users.find_one({"username": {"$regex": f"^{data.username}$", "$options": "i"}})
    if existing:
        raise HTTPException(status_code=400, detail="Это имя пользователя уже занято")
    
    if len(data.username) < 3 or len(data.username) > 20:
        raise HTTPException(status_code=400, detail="Имя пользователя должно быть от 3 до 20 символов")
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Пароль должен быть не менее 6 символов")
    
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
    
    await db.users.insert_one(user)
    
    # DO NOT return token - user must login manually
    return {"success": True, "message": "Аккаунт создан! Теперь войдите в систему", "username": data.username}

@api_router.post("/auth/login")
async def login(data: UserLogin):
    user = await db.users.find_one({"username": {"$regex": f"^{data.username}$", "$options": "i"}}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Неверные учётные данные")
    
    if not verify_password(data.password, user["passwordHash"]):
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
    
    # Check if user is approved (skip for admins)
    if not user.get("isAdmin", False) and not user.get("approved", False):
        # Mark that user attempted to login - show in admin panel
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"loginAttempted": True}}
        )
        raise HTTPException(status_code=403, detail="Ваш аккаунт ожидает одобрения администратора")
    
    token = create_token(user["id"], user["username"], user.get("isAdmin", False))
    user_response = {k: v for k, v in user.items() if k != "passwordHash"}
    return {"token": token, "user": user_response}

@api_router.get("/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    return {k: v for k, v in user.items() if k != "passwordHash"}

# ==================== GAME ROUTES ====================
@api_router.post("/game/submit")
async def submit_game_result(data: GameResult, user: dict = Depends(get_current_user)):
    # Check if user is approved
    if not user.get("approved", False):
        raise HTTPException(status_code=403, detail="Ваш аккаунт ожидает одобрения администратора")
    
    max_possible_score = data.timePlayedSeconds * 5
    if data.score > max_possible_score or data.score < 0:
        raise HTTPException(status_code=400, detail="Недопустимый результат игры")
    if data.timePlayedSeconds > 600:
        raise HTTPException(status_code=400, detail="Недопустимая продолжительность игры")
    
    now = datetime.now(timezone.utc)
    if user.get("lastGameTime"):
        last_time = datetime.fromisoformat(user["lastGameTime"].replace("Z", "+00:00"))
        if (now - last_time).total_seconds() < 10:
            raise HTTPException(status_code=429, detail="Подождите перед следующей игрой")
    
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
    
    new_xp = user.get("xp", 0) + xp_earned
    new_level = calculate_level(new_xp)
    new_coins = user.get("coins", 0) + coins_earned
    
    # ANTI-CHEAT: Check for suspicious gains (from_admin=False for game wins)
    old_coins = user.get("coins", 0)
    old_xp = user.get("xp", 0)
    old_level = user.get("level", 1)
    await check_suspicious_activity(user["id"], old_coins, new_coins, old_xp, new_xp, old_level, new_level, from_admin=False)
    
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
    
    update_data = {
        "coins": new_coins,
        "xp": new_xp,
        "level": new_level,
        "lastGameTime": now.isoformat()
    }
    
    if chest_dropped:
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": update_data, "$push": {"chests": chest_dropped}}
        )
    else:
        await db.users.update_one({"id": user["id"]}, {"$set": update_data})
    
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
async def purchase_item(data: PurchaseRequest, user: dict = Depends(get_current_user)):
    if data.itemType not in SHOP_ITEMS:
        raise HTTPException(status_code=400, detail="Неверный тип товара")
    
    item = SHOP_ITEMS[data.itemType]
    
    if user["coins"] < item["price"]:
        raise HTTPException(status_code=400, detail="Недостаточно монет")
    
    update_data = {"coins": user["coins"] - item["price"]}
    
    if data.itemType == "custom_role":
        if not data.itemName:
            raise HTTPException(status_code=400, detail="Введите название роли")
        if len(data.itemName) > 20:
            raise HTTPException(status_code=400, detail="Название роли не более 20 символов")
        update_data["roles"] = user.get("roles", []) + [data.itemName]
    elif data.itemType == "custom_gradient":
        if not data.itemName:
            raise HTTPException(status_code=400, detail="Введите название градиента")
        if len(data.itemName) > 20:
            raise HTTPException(status_code=400, detail="Название градиента не более 20 символов")
        update_data["roleGradients"] = user.get("roleGradients", []) + [data.itemName]
    elif data.itemType == "create_clan":
        if user.get("clan"):
            raise HTTPException(status_code=400, detail="У вас уже есть клан")
        if not data.itemName:
            raise HTTPException(status_code=400, detail="Введите название клана")
        if len(data.itemName) > 10:
            raise HTTPException(status_code=400, detail="Название клана не более 10 символов")
        update_data["clan"] = data.itemName
    elif data.itemType == "clan_category":
        if not user.get("clan"):
            raise HTTPException(status_code=400, detail="Сначала создайте клан")
        if user.get("clanCategory"):
            raise HTTPException(status_code=400, detail="У вас уже есть категория")
        update_data["clanCategory"] = True
    
    now = datetime.now(timezone.utc)
    purchase_record = {
        "item": item["name"],
        "itemName": data.itemName,
        "price": item["price"],
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H:%M")
    }
    
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": update_data, "$push": {"purchaseHistory": purchase_record}}
    )
    
    return {"success": True, "purchase": purchase_record, "newBalance": update_data["coins"]}

# ==================== TRANSFER ROUTES ====================
@api_router.post("/transfer")
async def transfer_coins(data: TransferRequest, user: dict = Depends(get_current_user)):
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="Сумма должна быть положительной")
    if data.amount > user["coins"]:
        raise HTTPException(status_code=400, detail="Недостаточно монет")
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
    
    await db.users.update_one({"id": user["id"]}, {"$inc": {"coins": -data.amount}})
    await db.users.update_one({"id": recipient["id"]}, {"$inc": {"coins": data.amount}})
    
    return {
        "success": True,
        "transferred": data.amount,
        "to": recipient["username"],
        "newBalance": user["coins"] - data.amount
    }

# ==================== BONUS ROUTES ====================
DAILY_BONUS = 50
WEEKLY_BONUS = 300

@api_router.post("/bonus/claim")
async def claim_bonus(data: BonusRequest, user: dict = Depends(get_current_user)):
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
        
        await db.users.update_one(
            {"id": user["id"]},
            {"$inc": {"coins": DAILY_BONUS}, "$set": {"lastDailyBonus": now.isoformat()}}
        )
        return {"success": True, "bonusType": "daily", "amount": DAILY_BONUS, "newBalance": user["coins"] + DAILY_BONUS}
    
    elif data.bonusType == "weekly":
        last_claim = user.get("lastWeeklyBonus")
        if last_claim:
            last_time = datetime.fromisoformat(last_claim.replace("Z", "+00:00"))
            days_since = (now - last_time).total_seconds() / 86400
            if days_since < 7:
                days_left = int(7 - days_since)
                raise HTTPException(status_code=400, detail=f"Еженедельный бонус доступен через {days_left} дн.")
        
        await db.users.update_one(
            {"id": user["id"]},
            {"$inc": {"coins": WEEKLY_BONUS}, "$set": {"lastWeeklyBonus": now.isoformat()}}
        )
        return {"success": True, "bonusType": "weekly", "amount": WEEKLY_BONUS, "newBalance": user["coins"] + WEEKLY_BONUS}

# ==================== CHEST ROUTES ====================
CHEST_REWARDS = {
    "common": {"min": 10, "max": 50},
    "rare": {"min": 50, "max": 150},
    "epic": {"min": 150, "max": 500}
}

@api_router.post("/chest/open")
async def open_chest(data: ChestRequest, user: dict = Depends(get_current_user)):
    chests = user.get("chests", [])
    chest = next((c for c in chests if c["id"] == data.chestId), None)
    
    if not chest:
        raise HTTPException(status_code=404, detail="Сундук не найден")
    
    reward = CHEST_REWARDS.get(chest["type"], CHEST_REWARDS["common"])
    coins_won = random.randint(reward["min"], reward["max"])
    
    await db.users.update_one(
        {"id": user["id"]},
        {"$inc": {"coins": coins_won}, "$pull": {"chests": {"id": data.chestId}}}
    )
    
    return {
        "success": True,
        "chestType": chest["type"],
        "coinsWon": coins_won,
        "newBalance": user["coins"] + coins_won
    }

# ==================== ADMIN ROUTES ====================
@api_router.post("/admin/add-coins")
async def admin_add_coins(data: AdminAddCoins, user: dict = Depends(get_current_user)):
    if not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="Сумма должна быть положительной")
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    # ANTI-CHEAT: Check for suspicious gains before updating (admin can bypass limits)
    old_coins = target.get("coins", 0)
    old_xp = target.get("xp", 0)
    old_level = target.get("level", 1)
    new_coins = old_coins + data.amount
    
    # Admin can give up to 10,000 without triggering ban
    if data.amount <= 10000:
        await check_suspicious_activity(target["id"], old_coins, new_coins, old_xp, old_xp, old_level, old_level, from_admin=True)
    else:
        # If admin gives >10,000, still check
        await check_suspicious_activity(target["id"], old_coins, new_coins, old_xp, old_xp, old_level, old_level, from_admin=False)
    
    await db.users.update_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"$inc": {"coins": data.amount}})
    
    return {"success": True, "addedCoins": data.amount, "toUser": target["username"], "newBalance": new_coins}

@api_router.post("/admin/remove-coins")
async def admin_remove_coins(data: AdminAddCoins, user: dict = Depends(get_current_user)):
    if not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="Сумма должна быть положительной")
    
    target = await db.users.find_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    # Don't allow negative balance
    new_balance = max(0, target["coins"] - data.amount)
    actual_removed = target["coins"] - new_balance
    
    await db.users.update_one({"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}}, {"$set": {"coins": new_balance}})
    
    return {"success": True, "removedCoins": actual_removed, "fromUser": target["username"], "newBalance": new_balance}

@api_router.post("/admin/delete-user")
async def admin_delete_user(data: AdminDeleteUser, user: dict = Depends(get_current_user)):
    if not user.get("isAdmin"):
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
async def admin_set_level(data: AdminSetLevel, user: dict = Depends(get_current_user)):
    if not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    if data.level < 1 or data.level > 100:
        raise HTTPException(status_code=400, detail="Уровень должен быть от 1 до 100")
    
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
    await check_suspicious_activity(target["id"], old_coins, old_coins, old_xp, total_xp, old_level, new_level, from_admin=True)
    
    # Calculate XP required for NEXT level (level + 1)
    xp_required_for_next = xp_for_next
    
    # Update user: set level, reset current XP to 0
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
async def admin_get_users(user: dict = Depends(get_current_user)):
    if not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    # Show only approved users (онлайн пользователи)
    users = await db.users.find({"approved": True}, {"_id": 0, "passwordHash": 0}).to_list(1000)
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
async def admin_give_chest(data: GiveChestRequest, user: dict = Depends(get_current_user)):
    if not user.get("isAdmin"):
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
CREATOR_PASSWORD = "synapthys5082_"

@api_router.post("/admin/ban")
async def admin_ban_user(data: BanUserRequest, user: dict = Depends(get_current_user)):
    if not user.get("isAdmin"):
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
async def admin_unban_user(data: BanUserRequest, user: dict = Depends(get_current_user)):
    if not user.get("isAdmin"):
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
async def admin_set_admin(data: SetAdminRequest, user: dict = Depends(get_current_user)):
    if not user.get("isAdmin"):
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
async def admin_remove_admin(data: SetAdminRequest, user: dict = Depends(get_current_user)):
    if not user.get("isAdmin"):
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

# ==================== PENDING WINS APPROVAL ====================
class ApproveWinRequest(BaseModel):
    winId: str

@api_router.get("/admin/pending-wins")
async def admin_get_pending_wins(user: dict = Depends(get_current_user)):
    if not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    # Get all pending wins
    pending = await db.pending_wins.find(
        {"status": "pending"},
        {"_id": 0}
    ).to_list(1000)
    return pending

@api_router.post("/admin/approve-win")
async def admin_approve_win(data: ApproveWinRequest, user: dict = Depends(get_current_user)):
    if not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    # Find pending win
    win = await db.pending_wins.find_one({"id": data.winId, "status": "pending"}, {"_id": 0})
    if not win:
        raise HTTPException(status_code=404, detail="Выигрыш не найден")
    
    # Get user
    target = await db.users.find_one({"id": win["userId"]}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    # Award coins and XP
    new_coins = target.get("coins", 0) + win["coinsEarned"]
    new_xp = target.get("xp", 0) + win["xpEarned"]
    new_level = calculate_level(new_xp)
    
    await db.users.update_one(
        {"id": win["userId"]},
        {"$set": {
            "coins": new_coins,
            "xp": new_xp,
            "level": new_level
        }}
    )
    
    # Mark win as approved
    await db.pending_wins.update_one(
        {"id": data.winId},
        {"$set": {"status": "approved", "approvedAt": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {
        "success": True,
        "message": f"Выигрыш одобрен для {target['username']}",
        "coinsAwarded": win["coinsEarned"],
        "xpAwarded": win["xpEarned"]
    }

@api_router.post("/admin/reject-win")
async def admin_reject_win(data: ApproveWinRequest, user: dict = Depends(get_current_user)):
    if not user.get("isAdmin"):
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

    
    await db.users.update_one(
        {"username": {"$regex": f"^{data.targetUsername}$", "$options": "i"}},
        {"$set": {"isAdmin": False}}
    )
    
    return {"success": True, "message": f"{target['username']} больше не администратор"}

@api_router.get("/admin/is-creator")
async def admin_is_creator(user: dict = Depends(get_current_user)):
    if not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    
    is_creator = user["username"].lower() == CREATOR_USERNAME.lower()
    return {"isCreator": is_creator}

# ==================== PENDING USERS MODERATION ====================
@api_router.get("/admin/pending-users")
async def admin_get_pending_users(user: dict = Depends(get_current_user)):
    if not user.get("isAdmin"):
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
async def admin_approve_user(data: ApproveUserRequest, user: dict = Depends(get_current_user)):
    if not user.get("isAdmin"):
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
async def admin_delete_pending(data: ApproveUserRequest, user: dict = Depends(get_current_user)):
    if not user.get("isAdmin"):
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
async def get_leaderboard(user: dict = Depends(get_current_user)):
    # Get top 50 approved non-admin NON-BANNED users sorted by coins
    cursor = db.users.find(
        {"isAdmin": {"$ne": True}, "approved": True, "isBanned": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "coins": 1, "level": 1}
    ).sort("coins", -1).limit(50)
    
    leaders = await cursor.to_list(length=50)
    return leaders

# ==================== CRASH GAME ====================
class CrashGameRequest(BaseModel):
    betAmount: int

@api_router.post("/crash/play")
async def crash_play(data: CrashGameRequest, user: dict = Depends(get_current_user)):
    # Check if user is approved
    if not user.get("approved", False):
        raise HTTPException(status_code=403, detail="Ваш аккаунт ожидает одобрения администратора")
    
    if data.betAmount < 10 or data.betAmount > 50000:
        raise HTTPException(status_code=400, detail="Ставка должна быть от 10 до 50000 монет")
    
    if user.get("coins", 0) < data.betAmount:
        raise HTTPException(status_code=400, detail="Недостаточно монет")
    
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
    # Deduct coins immediately
    await db.users.update_one(
        {"id": user["id"]},
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
        }
    )
    
    return {
        "success": True,
        "gameId": game_id,
        "crashMultiplier": crash_multiplier,
        "crashTime": crash_time,
        "betAmount": data.betAmount
    }

@api_router.post("/crash/complete")
async def crash_complete(user: dict = Depends(get_current_user)):
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
    
    # Normal win/loss - add back the bet amount + profit (winnings)
    new_balance = user.get("coins", 0) + bet_amount + profit
    
    await db.users.update_one(
        {"id": user["id"]},
        {
            "$set": {"coins": new_balance},
            "$unset": {"activeCrashGame": ""}
        }
    )
    
    return {
        "success": True,
        "crashMultiplier": active_game["crashMultiplier"],
        "won": won,  # Use the won variable, not active_game["won"]
        "betAmount": bet_amount,
        "winAmount": bet_amount + profit if won else 0,
        "profit": profit,
        "newBalance": new_balance
    }

# ==================== SHOP CHESTS ====================
class BuyChestRequest(BaseModel):
    chestType: str

@api_router.post("/shop/buy-chest")
async def shop_buy_chest(data: BuyChestRequest, user: dict = Depends(get_current_user)):
    chest_prices = {
        "common": 85,
        "rare": 275,
        "epic": 700
    }
    
    if data.chestType not in chest_prices:
        raise HTTPException(status_code=400, detail="Неверный тип сундука")
    
    price = chest_prices[data.chestType]
    
    if user.get("coins", 0) < price:
        raise HTTPException(status_code=400, detail="Недостаточно монет")
    
    chest = {
        "id": str(uuid.uuid4()),
        "type": data.chestType,
        "droppedAt": datetime.now(timezone.utc).isoformat()
    }
    
    await db.users.update_one(
        {"id": user["id"]},
        {
            "$inc": {"coins": -price},
            "$push": {"chests": chest}
        }
    )
    
    return {"success": True, "chest": chest, "newBalance": user["coins"] - price}

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
    admin = await db.users.find_one({"username": "pseudotamine"})
    if not admin:
        admin_id = str(uuid.uuid4())
        admin_user = {
            "id": admin_id,
            "username": "pseudotamine",
            "passwordHash": hash_password("synapthys5082_"),
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
