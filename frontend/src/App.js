import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, Link } from "react-router-dom";
import axios from "axios";
import { Toaster, toast } from "sonner";
import { 
  Home, Gamepad2, ShoppingCart, ArrowLeftRight, User, Shield, LogOut, 
  Coins, TrendingUp, Award, Users, Sun, Star, Package, Gift, 
  Send, Plus, RefreshCw, Eye, EyeOff, ChevronRight, Play, RotateCcw,
  Palette, FolderTree, Search, Clock, History, Box, Trophy
} from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Auth Context
const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(localStorage.getItem("token"));

  const login = async (username, password) => {
    const res = await axios.post(`${API}/auth/login`, { username, password });
    localStorage.setItem("token", res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    return res.data;
  };

  const register = async (username, password) => {
    const res = await axios.post(`${API}/auth/register`, { username, password });
    localStorage.setItem("token", res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    return res.data;
  };

  const logout = () => {
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
  };

  const refreshUser = async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Check if user is banned
      if (res.data.isBanned) {
        toast.error("Ваш аккаунт заблокирован");
        logout();
        return;
      }
      setUser(res.data);
    } catch (e) {
      logout();
    }
  };

  // Check ban status periodically
  useEffect(() => {
    if (!token || !user) return;
    const checkBanStatus = async () => {
      try {
        const res = await axios.get(`${API}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.data.isBanned) {
          toast.error("Ваш аккаунт заблокирован");
          logout();
        }
      } catch (e) {
        // ignore
      }
    };
    const interval = setInterval(checkBanStatus, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, [token, user]);

  useEffect(() => {
    const checkAuth = async () => {
      if (token) {
        try {
          const res = await axios.get(`${API}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          setUser(res.data);
        } catch (e) {
          logout();
        }
      }
      setLoading(false);
    };
    checkAuth();
  }, [token]);

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, refreshUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

// ==================== NAVBAR ====================
const Navbar = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const getXpProgress = () => {
    let level = 1, xpForNext = 100, remainingXp = user?.xp || 0;
    while (level < user?.level && level < 100) {
      remainingXp -= xpForNext;
      level++;
      xpForNext = Math.floor(xpForNext * 1.15);
    }
    return { percentage: Math.min((remainingXp / xpForNext) * 100, 100) };
  };

  const xpProgress = getXpProgress();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { path: "/dashboard", label: "Главная", icon: Home },
    { path: "/games", label: "Игры", icon: Gamepad2 },
    { path: "/shop", label: "Магазин", icon: ShoppingCart },
    { path: "/leaderboard", label: "Топ", icon: Trophy },
    { path: "/transfer", label: "Переводы", icon: ArrowLeftRight },
    { path: "/profile", label: "Профиль", icon: User },
  ];

  // Add admin to navbar for admins
  const allNavItems = [...navItems];
  if (user?.isAdmin) {
    allNavItems.push({ path: "/admin", label: "Админ", icon: Shield });
  }

  return (
    <>
      <nav className="fixed top-0 w-full z-50 bg-black/90 backdrop-blur-md border-b border-white/5 h-14 md:h-16" data-testid="navbar">
        <div className="max-w-7xl mx-auto h-full px-4 md:px-6 flex items-center justify-between">
          <Link to="/dashboard" className="font-orbitron text-lg md:text-xl font-bold text-white tracking-wider flex items-center gap-2" data-testid="nav-logo">
            <span className="text-glow">⛧</span> sukunaW
          </Link>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center gap-5">
            {allNavItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`font-orbitron text-xs uppercase tracking-widest transition-colors relative flex items-center gap-2
                  ${location.pathname === item.path ? "text-white" : "text-gray-400 hover:text-white"}`}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <item.icon size={14} strokeWidth={1.5} />
                {item.label}
                {location.pathname === item.path && (
                  <span className="absolute -bottom-1 left-0 w-full h-px bg-white" />
                )}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            <div className="hidden sm:flex flex-col items-end">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 font-orbitron">УР</span>
                <span className="font-orbitron font-bold text-white" data-testid="user-level">{user?.level || 1}</span>
              </div>
              <div className="w-16 h-1 bg-white/10 mt-1">
                <div className="h-full bg-white transition-all" style={{ width: `${xpProgress.percentage}%` }} />
              </div>
            </div>

            <div className="flex items-center gap-2 px-2 md:px-3 py-1.5 bg-white/5 border border-white/10">
              <Coins size={14} className="text-yellow-400" />
              <span className="font-orbitron font-bold text-white text-sm md:text-base" data-testid="user-coins">{user?.coins || 0}</span>
            </div>

            {user?.isAdmin && <span className="admin-badge hidden md:block" data-testid="admin-badge">АДМИН</span>}

            <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-white transition-colors" data-testid="logout-btn" title="Выйти">
              <LogOut size={18} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Bottom Nav */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-black/95 backdrop-blur-md border-t border-white/10 z-50">
        {/* Main icons row */}
        <div className="flex justify-around items-center py-2">
          {allNavItems.slice(0, 4).map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setMobileMenuOpen(false)}
              className={`flex flex-col items-center gap-0.5 py-1 px-2 ${location.pathname === item.path ? "text-white" : "text-gray-500"}`}
            >
              <item.icon size={20} strokeWidth={1.5} />
              <span className="text-[9px] font-orbitron">{item.label}</span>
            </Link>
          ))}
          {/* More button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className={`flex flex-col items-center gap-0.5 py-1 px-2 ${mobileMenuOpen ? "text-white" : "text-gray-500"}`}
          >
            <ChevronRight size={20} strokeWidth={1.5} className={`transition-transform ${mobileMenuOpen ? "rotate-90" : "-rotate-90"}`} />
            <span className="text-[9px] font-orbitron">Ещё</span>
          </button>
        </div>

        {/* Expandable menu */}
        {mobileMenuOpen && (
          <div className="border-t border-white/10 py-3 px-4 bg-black/95">
            <div className="grid grid-cols-3 gap-3">
              {allNavItems.slice(4).map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex flex-col items-center gap-1 py-3 px-2 rounded-lg border ${
                    location.pathname === item.path 
                      ? "text-white bg-white/10 border-white/20" 
                      : "text-gray-400 bg-white/5 border-white/10"
                  }`}
                >
                  <item.icon size={22} strokeWidth={1.5} />
                  <span className="text-[10px] font-orbitron">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

// ==================== LOGIN ====================
const Login = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) { toast.error("Заполните все поля"); return; }
    setLoading(true);
    try {
      await login(username, password);
      toast.success("Добро пожаловать!");
      navigate("/dashboard");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Неверные учётные данные");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex" data-testid="login-page">
      <div className="hidden lg:flex lg:w-1/2 bg-[#050505] items-center justify-center relative overflow-hidden">
        <div className="absolute top-20 left-20 w-40 h-40 border border-white/5 rotate-45" />
        <div className="absolute bottom-20 right-20 w-60 h-60 border border-white/5 rotate-12" />
        <div className="relative z-10 text-center px-12">
          <h1 className="font-orbitron text-7xl font-black text-white tracking-widest mb-6 text-glow">⛧</h1>
          <h2 className="font-orbitron text-5xl font-bold text-white tracking-[0.3em] mb-4">SUKUNA</h2>
          <p className="text-gray-500 font-rajdhani text-lg tracking-wider">ИГРОВАЯ ПЛАТФОРМА</p>
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-[#0A0A0A]">
        <div className="w-full max-w-md animate-fade-in">
          <div className="lg:hidden text-center mb-12">
            <h1 className="font-orbitron text-4xl font-bold text-white tracking-widest mb-2">⛧ sukunaW</h1>
            <p className="text-gray-500 text-sm">ИГРОВАЯ ПЛАТФОРМА</p>
          </div>
          <div className="mb-8">
            <h2 className="font-orbitron text-2xl font-bold text-white tracking-wider mb-2">ВХОД В СИСТЕМУ</h2>
            <p className="text-gray-500 font-rajdhani">Введите данные для продолжения</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="label-text">Имя пользователя</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="input-field" placeholder="Введите имя" data-testid="login-username" />
            </div>
            <div>
              <label className="label-text">Пароль</label>
              <div className="relative">
                <input type={showPass ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className="input-field pr-12" placeholder="Введите пароль" data-testid="login-password" />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full mt-8" data-testid="login-submit">
              {loading ? "Вход..." : "ВОЙТИ"}
            </button>
          </form>
          <div className="mt-8 text-center">
            <p className="text-gray-500 font-rajdhani">
              Нет аккаунта? <Link to="/register" className="text-white hover:underline" data-testid="register-link">Создать</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ==================== REGISTER ====================
const Register = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password || !confirm) { toast.error("Заполните все поля"); return; }
    if (password !== confirm) { toast.error("Пароли не совпадают"); return; }
    if (username.length < 3 || username.length > 20) { toast.error("Имя должно быть от 3 до 20 символов"); return; }
    if (password.length < 6) { toast.error("Пароль минимум 6 символов"); return; }
    
    setLoading(true);
    try {
      await register(username, password);
      toast.success("Аккаунт создан!");
      navigate("/dashboard");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка регистрации");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex" data-testid="register-page">
      <div className="hidden lg:flex lg:w-1/2 bg-[#050505] items-center justify-center relative overflow-hidden">
        <div className="absolute top-20 right-20 w-40 h-40 border border-white/5 rotate-45" />
        <div className="absolute bottom-20 left-20 w-60 h-60 border border-white/5 -rotate-12" />
        <div className="relative z-10 text-center px-12">
          <h1 className="font-orbitron text-7xl font-black text-white tracking-widest mb-6 text-glow">⛧</h1>
          <h2 className="font-orbitron text-5xl font-bold text-white tracking-[0.3em] mb-4">SUKUNA</h2>
          <p className="text-gray-500 font-rajdhani text-lg tracking-wider">ПРИСОЕДИНЯЙСЯ</p>
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-[#0A0A0A]">
        <div className="w-full max-w-md animate-fade-in">
          <div className="lg:hidden text-center mb-12">
            <h1 className="font-orbitron text-4xl font-bold text-white tracking-widest mb-2">⛧ sukunaW</h1>
          </div>
          <div className="mb-8">
            <h2 className="font-orbitron text-2xl font-bold text-white tracking-wider mb-2">РЕГИСТРАЦИЯ</h2>
            <p className="text-gray-500 font-rajdhani">Создайте аккаунт для начала</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="label-text">Имя пользователя</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="input-field" placeholder="От 3 до 20 символов" data-testid="register-username" />
            </div>
            <div>
              <label className="label-text">Пароль</label>
              <div className="relative">
                <input type={showPass ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className="input-field pr-12" placeholder="Минимум 6 символов" data-testid="register-password" />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div>
              <label className="label-text">Повторите пароль</label>
              <input type={showPass ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input-field" placeholder="Повторите пароль" data-testid="register-confirm" />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full mt-8" data-testid="register-submit">
              {loading ? "Создание..." : "СОЗДАТЬ АККАУНТ"}
            </button>
          </form>
          <div className="mt-8 text-center">
            <p className="text-gray-500 font-rajdhani">
              Уже есть аккаунт? <Link to="/login" className="text-white hover:underline" data-testid="login-link">Войти</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ==================== DASHBOARD ====================
const Dashboard = () => {
  const { user, token, refreshUser } = useAuth();
  const [claiming, setClaiming] = useState(false);

  const getXpProgress = () => {
    let level = 1, xpForNext = 100, remainingXp = user?.xp || 0;
    while (level < user?.level && level < 100) { remainingXp -= xpForNext; level++; xpForNext = Math.floor(xpForNext * 1.15); }
    return { current: Math.max(0, remainingXp), needed: xpForNext, percentage: Math.min((remainingXp / xpForNext) * 100, 100) };
  };

  const xpProgress = getXpProgress();
  const chests = user?.chests || [];

  const getBonusStatus = (lastClaim, hoursRequired) => {
    if (!lastClaim) return { available: true, text: "Доступен!" };
    const hoursSince = (Date.now() - new Date(lastClaim).getTime()) / (1000 * 60 * 60);
    if (hoursSince >= hoursRequired) return { available: true, text: "Доступен!" };
    const left = Math.ceil(hoursRequired - hoursSince);
    return { available: false, text: left >= 24 ? `Через ${Math.ceil(left / 24)} дн.` : `Через ${left} ч.` };
  };

  const dailyStatus = getBonusStatus(user?.lastDailyBonus, 24);
  const weeklyStatus = getBonusStatus(user?.lastWeeklyBonus, 168);

  const claimBonus = async (type) => {
    setClaiming(true);
    try {
      const res = await axios.post(`${API}/bonus/claim`, { bonusType: type }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(`+${res.data.amount} монет!`);
      await refreshUser();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка");
    } finally { setClaiming(false); }
  };

  return (
    <div className="min-h-screen pt-20 pb-24 md:pb-8 px-4 md:px-8" data-testid="dashboard-page">
      <div className="max-w-7xl mx-auto">
        <h1 className="font-orbitron text-3xl font-bold text-white tracking-wider mb-2 text-glow">
          Добро пожаловать, {user?.username}
        </h1>
        <p className="text-gray-500 font-rajdhani mb-8">Ваш командный центр</p>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="card animate-fade-in">
            <div className="w-12 h-12 flex items-center justify-center bg-yellow-500/10 border border-yellow-500/30 mb-3">
              <Coins size={24} className="text-yellow-400" />
            </div>
            <div className="label-text">Монеты</div>
            <div className="font-orbitron text-3xl font-bold text-yellow-400" data-testid="dashboard-coins">{user?.coins || 0}</div>
          </div>
          <div className="card animate-fade-in" style={{ animationDelay: "0.1s" }}>
            <div className="w-12 h-12 flex items-center justify-center bg-white/10 border border-white/30 mb-3">
              <TrendingUp size={24} className="text-white" />
            </div>
            <div className="label-text">Уровень</div>
            <div className="font-orbitron text-3xl font-bold text-white" data-testid="dashboard-level">{user?.level || 1}</div>
            <div className="progress-bar mt-2"><div className="progress-fill" style={{ width: `${xpProgress.percentage}%` }} /></div>
            <p className="text-gray-500 text-xs mt-1">{xpProgress.current} / {xpProgress.needed} XP</p>
          </div>
          <div className="card animate-fade-in" style={{ animationDelay: "0.15s" }}>
            <div className="w-12 h-12 flex items-center justify-center bg-white/10 border border-white/30 mb-3">
              <Award size={24} className="text-white" />
            </div>
            <div className="label-text">Роли</div>
            <div className="font-orbitron text-3xl font-bold text-white">{user?.roles?.length || 0}</div>
          </div>
          <div className="card animate-fade-in" style={{ animationDelay: "0.2s" }}>
            <div className="w-12 h-12 flex items-center justify-center bg-white/10 border border-white/30 mb-3">
              <Users size={24} className="text-white" />
            </div>
            <div className="label-text">Клан</div>
            <div className="font-orbitron text-xl font-bold text-white truncate">{user?.clan || "Нет"}</div>
          </div>
        </div>

        {/* Bonuses */}
        <h2 className="font-orbitron text-xl font-bold text-white mb-4 tracking-wider flex items-center gap-2">
          <Gift size={20} /> БОНУСЫ
        </h2>
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <div className="card text-center animate-fade-in">
            <div className="w-16 h-16 mx-auto flex items-center justify-center bg-orange-500/10 border border-orange-500/30 mb-4">
              <Sun size={32} className="text-orange-400" />
            </div>
            <div className="font-orbitron text-lg mb-2">ЕЖЕДНЕВНЫЙ</div>
            <div className="font-orbitron text-2xl text-yellow-400 mb-4 flex items-center justify-center gap-2">
              +50 <Coins size={20} />
            </div>
            <p className="text-gray-400 mb-4 flex items-center justify-center gap-2">
              <Clock size={14} /> {dailyStatus.text}
            </p>
            <button onClick={() => claimBonus("daily")} disabled={!dailyStatus.available || claiming} className="btn-secondary" data-testid="claim-daily">
              ЗАБРАТЬ
            </button>
          </div>
          <div className="card text-center animate-fade-in" style={{ animationDelay: "0.1s" }}>
            <div className="w-16 h-16 mx-auto flex items-center justify-center bg-purple-500/10 border border-purple-500/30 mb-4">
              <Star size={32} className="text-purple-400" />
            </div>
            <div className="font-orbitron text-lg mb-2">ЕЖЕНЕДЕЛЬНЫЙ</div>
            <div className="font-orbitron text-2xl text-yellow-400 mb-4 flex items-center justify-center gap-2">
              +300 <Coins size={20} />
            </div>
            <p className="text-gray-400 mb-4 flex items-center justify-center gap-2">
              <Clock size={14} /> {weeklyStatus.text}
            </p>
            <button onClick={() => claimBonus("weekly")} disabled={!weeklyStatus.available || claiming} className="btn-secondary" data-testid="claim-weekly">
              ЗАБРАТЬ
            </button>
          </div>
        </div>

        {/* Chests */}
        {chests.length > 0 && (
          <div className="mb-8">
            <h2 className="font-orbitron text-xl font-bold text-white mb-4 tracking-wider flex items-center gap-2">
              <Package size={20} /> СУНДУКИ ({chests.length})
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {chests.map((chest) => (
                <ChestCard key={chest.id} chest={chest} />
              ))}
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <h2 className="font-orbitron text-xl font-bold text-white mb-4 tracking-wider flex items-center gap-2">
          <ChevronRight size={20} /> БЫСТРЫЕ ДЕЙСТВИЯ
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { to: "/game", icon: Gamepad2, title: "ИГРАТЬ", desc: "Фармить монеты" },
            { to: "/shop", icon: ShoppingCart, title: "МАГАЗИН", desc: "Покупать предметы" },
            { to: "/transfer", icon: ArrowLeftRight, title: "ПЕРЕВОД", desc: "Отправить монеты" },
            { to: "/profile", icon: User, title: "ПРОФИЛЬ", desc: "Ваша статистика" },
          ].map((action, i) => (
            <Link key={action.to} to={action.to} className="card hover:border-white/40 transition-all cursor-pointer animate-fade-in" style={{ animationDelay: `${0.3 + i * 0.05}s` }}>
              <action.icon size={32} className="mb-4 text-white" strokeWidth={1} />
              <div className="font-orbitron text-sm mb-1">{action.title}</div>
              <div className="text-gray-500 text-sm">{action.desc}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};

// ==================== CHEST CARD ====================
const ChestCard = ({ chest }) => {
  const { token, refreshUser } = useAuth();
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState(null);
  const [showRoulette, setShowRoulette] = useState(false);
  const [rouletteItems, setRouletteItems] = useState([]);
  const [finalReward, setFinalReward] = useState(null);
  const rouletteRef = useRef(null);

  const getChestStyle = (type) => {
    switch(type) {
      case 'epic': return { color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30', name: 'Эпический', minCoins: 200, maxCoins: 1000 };
      case 'rare': return { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', name: 'Редкий', minCoins: 75, maxCoins: 400 };
      default: return { color: 'text-gray-400', bg: 'bg-white/10', border: 'border-white/30', name: 'Обычный', minCoins: 10, maxCoins: 150 };
    }
  };

  const style = getChestStyle(chest.type);

  // Generate random items for roulette
  const generateRouletteItems = (min, max, actualReward) => {
    const items = [];
    // Generate 50 random values
    for (let i = 0; i < 50; i++) {
      items.push(Math.floor(Math.random() * (max - min + 1)) + min);
    }
    // Place actual reward at position 42 (where it will stop)
    items[42] = actualReward;
    return items;
  };

  const openChest = async () => {
    setOpening(true);
    try {
      const res = await axios.post(`${API}/chest/open`, { chestId: chest.id }, { headers: { Authorization: `Bearer ${token}` } });
      const reward = res.data.coinsWon;
      
      // Generate roulette items
      const items = generateRouletteItems(style.minCoins, style.maxCoins, reward);
      setRouletteItems(items);
      setFinalReward(reward);
      setShowRoulette(true);
      
      // Start animation after a small delay
      setTimeout(() => {
        if (rouletteRef.current) {
          rouletteRef.current.style.transition = 'transform 4s cubic-bezier(0.15, 0.85, 0.35, 1)';
          rouletteRef.current.style.transform = `translateX(-${42 * 120}px)`;
        }
      }, 100);
      
      // Show result after animation
      setTimeout(() => {
        setShowRoulette(false);
        setResult(res.data);
        toast.success(`Вы выиграли ${res.data.coinsWon} монет!`, { duration: 5000 });
        refreshUser();
      }, 4500);
      
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка");
      setOpening(false);
    }
  };

  // Roulette modal
  if (showRoulette) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={(e) => e.stopPropagation()}>
        <div className="w-full max-w-2xl mx-4">
          {/* Chest type header */}
          <div className={`text-center mb-6 font-orbitron text-xl ${style.color}`}>
            {style.name} сундук
          </div>
          
          {/* Roulette container */}
          <div className="relative overflow-hidden bg-black/50 border border-white/20 p-4">
            {/* Center marker */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1 h-full bg-yellow-400 z-10 shadow-[0_0_20px_rgba(250,204,21,0.8)]" />
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[12px] border-r-[12px] border-t-[16px] border-l-transparent border-r-transparent border-t-yellow-400 z-10" />
            
{/* Roulette strip */}
<div 
  ref={rouletteRef}
  className="flex items-center gap-2 py-4"
  style={{ transform: 'translateX(300px)' }}
>
  {rouletteItems.map((coins, index) => {
    return (
      <div 
        key={index}
        className="flex-shrink-0 w-28 h-24 flex items-center justify-center border bg-white/5 border-white/20"
      >
        <Coins size={24} className="text-yellow-400" />
      </div>
    );
  })}
</div>
</div>
          
          <div className="text-center mt-4 text-gray-400 text-sm">
            Крутится...
          </div>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="card text-center p-6 animate-fade-in-up">
        <Coins size={32} className="mx-auto mb-3 text-yellow-400" />
        <div className="font-orbitron text-2xl text-yellow-400 mb-2">+{result.coinsWon}</div>
        <div className="text-gray-400 text-sm">монет!</div>
      </div>
    );
  }

  return (
    <div onClick={!opening ? openChest : undefined} className={`card text-center cursor-pointer hover:border-white/40 transition-all ${opening ? "" : "hover:scale-105"}`} data-testid={`chest-${chest.id}`}>
      <div className={`w-12 h-12 mx-auto flex items-center justify-center ${style.bg} ${style.border} border mb-2 ${opening ? "animate-chest-bounce" : ""}`}>
        <Box size={24} className={style.color} />
      </div>
      <div className={`font-orbitron text-xs ${style.color}`}>{style.name}</div>
    </div>
  );
};

// ==================== DODGE GAME ====================
const DodgeGameInner = () => {
  const { user, token, refreshUser } = useAuth();
  const canvasRef = useRef(null);
  const [gameState, setGameState] = useState("idle");
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [lastResult, setLastResult] = useState(null);

  const gameRef = useRef({
    running: false,
    player: { x: 300, y: 350, size: 15 },
    enemies: [],
    startTime: 0,
    score: 0,
    animationId: null,
    spawnInterval: null,
    speedMultiplier: 1,
  });

  const keysRef = useRef({ up: false, down: false, left: false, right: false });
  const touchRef = useRef({ x: null, y: null });

  // Keyboard events - attach to window
  useEffect(() => {
    const handleKeyDown = (e) => {
      const key = e.key.toLowerCase();
      if (key === "arrowup" || key === "w") { keysRef.current.up = true; e.preventDefault(); }
      if (key === "arrowdown" || key === "s") { keysRef.current.down = true; e.preventDefault(); }
      if (key === "arrowleft" || key === "a") { keysRef.current.left = true; e.preventDefault(); }
      if (key === "arrowright" || key === "d") { keysRef.current.right = true; e.preventDefault(); }
    };

    const handleKeyUp = (e) => {
      const key = e.key.toLowerCase();
      if (key === "arrowup" || key === "w") keysRef.current.up = false;
      if (key === "arrowdown" || key === "s") keysRef.current.down = false;
      if (key === "arrowleft" || key === "a") keysRef.current.left = false;
      if (key === "arrowright" || key === "d") keysRef.current.right = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Touch handlers
  const handleTouchStart = (e) => {
    if (!gameRef.current.running) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvasRef.current.getBoundingClientRect();
    touchRef.current.x = (touch.clientX - rect.left) * (600 / rect.width);
    touchRef.current.y = (touch.clientY - rect.top) * (400 / rect.height);
  };

  const handleTouchMove = (e) => {
    if (!gameRef.current.running) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvasRef.current.getBoundingClientRect();
    touchRef.current.x = (touch.clientX - rect.left) * (600 / rect.width);
    touchRef.current.y = (touch.clientY - rect.top) * (400 / rect.height);
  };

  const handleTouchEnd = () => {
    touchRef.current = { x: null, y: null };
  };

  const spawnEnemy = useCallback(() => {
    const g = gameRef.current;
    if (!g.running) return;
    
    const player = g.player;
    
    // 70% chance enemy targets player, 30% random
    const targetPlayer = Math.random() < 0.7;
    let x, vx, vy;
    
    if (targetPlayer) {
      // Spawn from top, aim at player
      x = Math.random() * 600;
      const dx = player.x - x;
      const dy = player.y + 50; // aim slightly ahead
      const dist = Math.sqrt(dx * dx + dy * dy);
      const baseSpeed = (2 + Math.random() * 2) * g.speedMultiplier;
      vx = (dx / dist) * baseSpeed * 0.5;
      vy = (dy / dist) * baseSpeed;
    } else {
      // Random movement
      x = Math.random() * 540 + 30;
      vx = (Math.random() - 0.5) * 2;
      vy = (2 + Math.random() * 2) * g.speedMultiplier;
    }
    
    g.enemies.push({
      x,
      y: -20,
      size: 18 + Math.random() * 12,
      vx,
      vy,
    });
  }, []);

  const startGame = useCallback(() => {
    const g = gameRef.current;
    g.running = true;
    g.player = { x: 300, y: 350, size: 15 };
    g.enemies = [];
    g.startTime = Date.now();
    g.score = 0;
    g.speedMultiplier = 1;
    keysRef.current = { up: false, down: false, left: false, right: false };
    touchRef.current = { x: null, y: null };

    setScore(0);
    setGameState("playing");
    setLastResult(null);

    // Spawn enemies - starts faster, gets even faster
    let spawnRate = 1200;
    const scheduleSpawn = () => {
      if (!g.running) return;
      spawnEnemy();
      // Decrease spawn rate as score increases
      spawnRate = Math.max(400, 1200 - g.score * 15);
      g.spawnInterval = setTimeout(scheduleSpawn, spawnRate);
    };
    g.spawnInterval = setTimeout(scheduleSpawn, 500);

    // Game loop
    const loop = () => {
      if (!g.running) return;
      
      const keys = keysRef.current;
      const touch = touchRef.current;
      const speed = 6;

      // Keyboard movement
      if (keys.up && g.player.y > g.player.size) g.player.y -= speed;
      if (keys.down && g.player.y < 400 - g.player.size) g.player.y += speed;
      if (keys.left && g.player.x > g.player.size) g.player.x -= speed;
      if (keys.right && g.player.x < 600 - g.player.size) g.player.x += speed;

      // Touch movement
      if (touch.x !== null && touch.y !== null) {
        const dx = touch.x - g.player.x;
        const dy = touch.y - g.player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 5) {
          g.player.x += (dx / dist) * speed;
          g.player.y += (dy / dist) * speed;
        }
      }

      // Constrain player within canvas boundaries
      g.player.x = Math.max(g.player.size, Math.min(600 - g.player.size, g.player.x));
      g.player.y = Math.max(g.player.size, Math.min(400 - g.player.size, g.player.y));

      // Speed increases at milestones
      if (g.score >= 50) g.speedMultiplier = 1.5;
      if (g.score >= 100) g.speedMultiplier = 2;
      if (g.score >= 150) g.speedMultiplier = 2.5;

      // Update enemies
      let collision = false;
      g.enemies = g.enemies.filter((e) => {
        e.x += e.vx;
        e.y += e.vy;
        
        // Bounce off walls
        if (e.x < e.size/2 || e.x > 600 - e.size/2) e.vx *= -1;
        
        // Check collision
        const dx = g.player.x - e.x;
        const dy = g.player.y - e.y;
        if (Math.sqrt(dx * dx + dy * dy) < (g.player.size + e.size) / 2) {
          collision = true;
        }
        
        // Remove if off screen
        if (e.y > 420) {
          g.score++;
          setScore(g.score);
          return false;
        }
        return true;
      });

      // Draw
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        
        // Background
        ctx.fillStyle = "#050505";
        ctx.fillRect(0, 0, 600, 400);

        // Grid
        ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
        ctx.lineWidth = 1;
        for (let i = 0; i < 600; i += 30) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 400); ctx.stroke(); }
        for (let i = 0; i < 400; i += 30) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(600, i); ctx.stroke(); }

        // Enemies
        g.enemies.forEach((e) => {
          ctx.fillStyle = "rgba(239, 68, 68, 0.9)";
          ctx.shadowColor = "#EF4444";
          ctx.shadowBlur = 15;
          ctx.fillRect(e.x - e.size/2, e.y - e.size/2, e.size, e.size);
        });

        // Player
        ctx.fillStyle = "#FFFFFF";
        ctx.shadowColor = "#FFFFFF";
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.moveTo(g.player.x, g.player.y - g.player.size);
        ctx.lineTo(g.player.x - g.player.size, g.player.y + g.player.size);
        ctx.lineTo(g.player.x + g.player.size, g.player.y + g.player.size);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;

        // HUD
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "bold 16px Orbitron, monospace";
        ctx.textAlign = "left";
        ctx.fillText(`СЧЁТ: ${g.score}`, 20, 30);
        ctx.fillText(`СКОРОСТЬ: x${g.speedMultiplier.toFixed(1)}`, 20, 55);
        
        const elapsed = Math.floor((Date.now() - g.startTime) / 1000);
        ctx.textAlign = "right";
        ctx.fillText(`ВРЕМЯ: ${elapsed}с`, 580, 30);
      }

      if (collision) {
        endGame();
      } else {
        g.animationId = requestAnimationFrame(loop);
      }
    };
    g.animationId = requestAnimationFrame(loop);
  }, [spawnEnemy]);

  const endGame = async () => {
    const g = gameRef.current;
    g.running = false;
    clearTimeout(g.spawnInterval);
    cancelAnimationFrame(g.animationId);

    const finalScore = g.score;
    const timePlayedSeconds = Math.floor((Date.now() - g.startTime) / 1000);
    setGameState("ended");

    if (finalScore > highScore) setHighScore(finalScore);

    try {
      const res = await axios.post(`${API}/game/submit`, { score: finalScore, timePlayedSeconds }, { headers: { Authorization: `Bearer ${token}` } });
      setLastResult(res.data);
      await refreshUser();
      toast.success(`+${res.data.coinsEarned} монет, +${res.data.xpEarned} XP!`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка");
    }
  };

  // Draw idle state
  useEffect(() => {
    if (gameState === "idle") {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#050505";
      ctx.fillRect(0, 0, 600, 400);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
      for (let i = 0; i < 600; i += 30) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 400); ctx.stroke(); }
      for (let i = 0; i < 400; i += 30) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(600, i); ctx.stroke(); }
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 28px Orbitron, monospace";
      ctx.textAlign = "center";
      ctx.fillText("DODGE", 300, 180);
      ctx.font = "18px Rajdhani, sans-serif";
      ctx.fillStyle = "#A1A1AA";
      ctx.fillText("Уклоняйся от красных врагов", 300, 220);
    }
  }, [gameState]);

  // Cleanup
  useEffect(() => {
    return () => {
      const g = gameRef.current;
      g.running = false;
      clearTimeout(g.spawnInterval);
      cancelAnimationFrame(g.animationId);
    };
  }, []);

  return (
    <div className="pb-24 md:pb-8" data-testid="game-page">
      <div className="max-w-4xl mx-auto">
        <h1 className="font-orbitron text-xl md:text-2xl font-bold text-white tracking-wider mb-2 flex items-center gap-2">
          <Gamepad2 size={22} /> DODGE АРЕНА
        </h1>
        <p className="text-gray-500 font-rajdhani mb-4 md:mb-6 text-sm md:text-base">Уклоняйся от врагов и зарабатывай монеты</p>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="card text-center p-4">
            <div className="label-text">СЧЁТ</div>
            <div className="font-orbitron text-2xl font-bold text-white" data-testid="current-score">{String(score)}</div>
          </div>
          <div className="card text-center p-4">
            <div className="label-text">РЕКОРД</div>
            <div className="font-orbitron text-2xl font-bold text-white" data-testid="high-score">{String(highScore)}</div>
          </div>
          <div className="card text-center p-4">
            <div className="label-text">МОНЕТЫ</div>
            <div className="font-orbitron text-2xl font-bold text-yellow-400 flex items-center justify-center gap-2" data-testid="your-coins">
              <Coins size={18} /> {user?.coins || 0}
            </div>
          </div>
        </div>

        <div className="card p-4 md:p-6 mb-6">
          <div className="relative mx-auto" style={{ maxWidth: 600 }}>
            <canvas
              ref={canvasRef}
              width={600}
              height={400}
              className="game-canvas w-full"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              tabIndex={0}
              data-testid="game-canvas"
            />

            {gameState !== "playing" && (
              <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center">
                <h2 className="font-orbitron text-2xl font-bold text-white mb-4">
                  {gameState === "ended" ? "ИГРА ОКОНЧЕНА" : "DODGE"}
                </h2>
                <p className="text-gray-400 font-rajdhani mb-4">
                  {gameState === "ended" ? `Финальный счёт: ${score}` : "Уклоняйся от красных врагов"}
                </p>
                {lastResult && (
                  <div className="text-center mb-6">
                    <p className="text-green-400 font-orbitron flex items-center justify-center gap-2">
                      +{lastResult.coinsEarned} <Coins size={16} />
                    </p>
                    <p className="text-blue-400 font-orbitron">+{lastResult.xpEarned} XP</p>
                    {lastResult.chestDropped && (
                      <p className="text-purple-400 mt-2 flex items-center justify-center gap-2">
                        <Package size={16} /> Выпал сундук!
                      </p>
                    )}
                  </div>
                )}
                <button onClick={startGame} className="btn-primary flex items-center gap-2" data-testid="start-game-btn">
                  {gameState === "ended" ? <><RotateCcw size={18} /> ИГРАТЬ СНОВА</> : <><Play size={18} /> НАЧАТЬ ИГРУ</>}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="card p-4">
            <h3 className="font-orbitron text-sm font-bold text-white mb-4 flex items-center gap-2">
              <Gamepad2 size={16} /> УПРАВЛЕНИЕ
            </h3>
            <div className="grid grid-cols-2 gap-4 text-gray-400 text-sm">
              <div><strong>ПК:</strong> WASD или стрелки</div>
              <div><strong>Мобильный:</strong> Касание</div>
            </div>
          </div>
          <div className="card p-4">
            <h3 className="font-orbitron text-sm font-bold text-white mb-4 flex items-center gap-2">
              <TrendingUp size={16} /> СЛОЖНОСТЬ
            </h3>
            <div className="text-gray-400 text-sm space-y-1">
              <div>50 очков → скорость x1.5</div>
              <div>100 очков → скорость x2.0</div>
              <div>150 очков → скорость x2.5</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ==================== CLICKER GAME ====================
const ClickerGameInner = () => {
  const { user, token, refreshUser } = useAuth();
  const [clicks, setClicks] = useState(0);
  const [coinsEarned, setCoinsEarned] = useState(0);
  const [clickPower, setClickPower] = useState(1);
  const [autoClickerLevel, setAutoClickerLevel] = useState(0);
  const [isShaking, setIsShaking] = useState(false);
  const [intensity, setIntensity] = useState(0);
  const [saving, setSaving] = useState(false);
  const clickTimeoutRef = useRef(null);
  const autoClickerRef = useRef(null);

  // Upgrades prices
  const upgrades = {
    clickPower: { name: "Сила клика", basePrice: 500, maxLevel: 10, perLevel: 0.05 }, // +0.05 per level, max 0.5
    autoClicker: { name: "Автокликер", basePrice: 1000, maxLevel: 5, perLevel: 1 } // 1 click per 3 seconds per level
  };

  const getUpgradePrice = (type, currentLevel) => {
    return upgrades[type].basePrice + (currentLevel * 200);
  };

  const maxCoinsPerClick = 0.05 + (clickPower - 1) * 0.05; // Base 0.05, max 0.5 at level 10

  // Handle click
  const handleClick = () => {
    setClicks(prev => prev + 1);
    const earned = maxCoinsPerClick;
    setCoinsEarned(prev => prev + earned);
    
    // Increase intensity
    setIntensity(prev => Math.min(100, prev + 5));
    setIsShaking(true);
    
    // Reset shake after short delay
    if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
    clickTimeoutRef.current = setTimeout(() => {
      setIsShaking(false);
      setIntensity(prev => Math.max(0, prev - 20));
    }, 150);
  };

  // Auto clicker
  useEffect(() => {
    if (autoClickerLevel > 0) {
      autoClickerRef.current = setInterval(() => {
        setClicks(prev => prev + 1);
        setCoinsEarned(prev => prev + maxCoinsPerClick);
      }, 3000 / autoClickerLevel); // Slower: 3 seconds base
    }
    return () => {
      if (autoClickerRef.current) clearInterval(autoClickerRef.current);
    };
  }, [autoClickerLevel, maxCoinsPerClick]);

  // Decay intensity over time
  useEffect(() => {
    const decay = setInterval(() => {
      setIntensity(prev => Math.max(0, prev - 2));
    }, 100);
    return () => clearInterval(decay);
  }, []);

  // Buy upgrade
  const buyUpgrade = async (type) => {
    const currentLevel = type === 'clickPower' ? clickPower - 1 : autoClickerLevel;
    if (currentLevel >= upgrades[type].maxLevel) {
      toast.error("Максимальный уровень!");
      return;
    }
    
    const price = getUpgradePrice(type, currentLevel);
    if ((user?.coins || 0) < price) {
      toast.error("Недостаточно монет!");
      return;
    }

    try {
      await axios.post(`${API}/clicker/upgrade`, { upgradeType: type }, { headers: { Authorization: `Bearer ${token}` } });
      if (type === 'clickPower') {
        setClickPower(prev => prev + 1);
      } else {
        setAutoClickerLevel(prev => prev + 1);
      }
      toast.success(`${upgrades[type].name} улучшен!`);
      refreshUser();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка");
    }
  };

  // Save coins
  const saveCoins = async () => {
    if (coinsEarned < 1) {
      toast.error("Накопите минимум 1 монету");
      return;
    }
    
    setSaving(true);
    try {
      const res = await axios.post(`${API}/clicker/save`, { coins: Math.floor(coinsEarned) }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(`+${res.data.coinsAdded} монет сохранено!`);
      setCoinsEarned(coinsEarned - Math.floor(coinsEarned)); // Keep decimal part
      setClicks(0);
      refreshUser();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  // Star gradient based on intensity
  const getStarStyle = () => {
    const red = Math.min(255, 150 + intensity);
    const green = Math.max(0, 100 - intensity);
    const blue = Math.max(0, 100 - intensity);
    return {
      background: `linear-gradient(135deg, rgb(${red}, ${green}, ${blue}), rgb(${Math.min(255, red + 50)}, ${Math.max(0, green - 30)}, ${Math.max(0, blue - 30)}))`,
      boxShadow: `0 0 ${10 + intensity / 2}px rgba(${red}, ${green / 2}, ${blue / 2}, ${0.3 + intensity / 200})`,
    };
  };

  return (
    <div className="pb-24 md:pb-8">
      <div className="text-center mb-6 md:mb-8">
        <h1 className="font-orbitron text-xl md:text-2xl font-bold tracking-wider flex items-center justify-center gap-3">
          <span className="text-2xl md:text-3xl">⛧</span> КЛИКЕР
        </h1>
        <p className="text-gray-400 mt-2 text-sm md:text-base">Кликай и зарабатывай монеты!</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 md:gap-4 mb-6 md:mb-8">
        <div className="card text-center p-2 md:p-4">
          <div className="text-gray-400 text-xs md:text-sm">Кликов</div>
          <div className="font-orbitron text-lg md:text-2xl">{clicks}</div>
        </div>
        <div className="card text-center p-2 md:p-4">
          <div className="text-gray-400 text-xs md:text-sm">Накоплено</div>
          <div className="font-orbitron text-lg md:text-2xl text-yellow-400">{coinsEarned.toFixed(2)}</div>
        </div>
        <div className="card text-center p-2 md:p-4">
          <div className="text-gray-400 text-xs md:text-sm">За клик</div>
          <div className="font-orbitron text-lg md:text-2xl text-green-400">{maxCoinsPerClick.toFixed(2)}</div>
        </div>
      </div>

      {/* Clicker Star */}
      <div className="flex justify-center mb-6 md:mb-8">
        <button
          onClick={handleClick}
          className={`relative w-32 h-32 sm:w-40 sm:h-40 md:w-48 md:h-48 rounded-full flex items-center justify-center transition-all duration-100 cursor-pointer select-none active:scale-95 ${isShaking ? 'animate-shake' : ''}`}
          style={getStarStyle()}
          data-testid="clicker-star"
        >
          <span 
            className="text-5xl sm:text-6xl md:text-7xl text-white drop-shadow-lg select-none"
            style={{
              transform: isShaking ? `scale(${1 + intensity / 200})` : 'scale(1)',
              transition: 'transform 0.1s'
            }}
          >⛧</span>
          {intensity > 50 && (
            <div className="absolute inset-0 rounded-full animate-pulse" style={{
              background: `radial-gradient(circle, rgba(255,100,100,0.3) 0%, transparent 70%)`,
            }} />
          )}
        </button>
      </div>

      {/* Intensity bar */}
      <div className="max-w-md mx-auto mb-6 md:mb-8 px-4">
        <div className="flex justify-between text-xs md:text-sm text-gray-400 mb-1">
          <span>Интенсивность</span>
          <span>{Math.round(intensity)}%</span>
        </div>
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <div 
            className="h-full transition-all duration-100"
            style={{ 
              width: `${intensity}%`,
              background: `linear-gradient(90deg, #fbbf24, #ef4444)`
            }}
          />
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-center mb-8">
        <button
          onClick={saveCoins}
          disabled={saving || coinsEarned < 1}
          className="btn-primary px-8 py-3 flex items-center gap-2"
          data-testid="clicker-save"
        >
          <Coins size={18} />
          {saving ? "..." : `СОХРАНИТЬ ${Math.floor(coinsEarned)}`}
        </button>
      </div>
    </div>
  );
};

// ==================== GAMES HUB ====================
const GamesHub = () => {
  const [activeGame, setActiveGame] = useState(null); // null, 'dodge', 'clicker'

  return (
    <div className="main-content">
      <Navbar />
      <div className="page-container">
        {!activeGame && (
          <>
            <div className="text-center mb-6 md:mb-8">
              <h1 className="font-orbitron text-2xl md:text-3xl font-bold tracking-wider flex items-center justify-center gap-3">
                <Gamepad2 size={28} /> ИГРЫ
              </h1>
              <p className="text-gray-400 mt-2 text-sm md:text-base">Выберите игру для заработка монет</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-8 max-w-4xl mx-auto">
              {/* Dodge Game Card */}
              <div 
                className="card cursor-pointer hover:border-white/40 transition-all active:scale-95 md:hover:scale-105 p-4 md:p-8"
                onClick={() => setActiveGame('dodge')}
                data-testid="select-dodge"
              >
                <div className="w-16 h-16 md:w-20 md:h-20 mx-auto flex items-center justify-center bg-red-500/20 border border-red-500/30 rounded-lg mb-4 md:mb-6">
                  <Gamepad2 size={32} className="text-red-400" />
                </div>
                <h2 className="font-orbitron text-lg md:text-xl text-center mb-2 md:mb-3">DODGE</h2>
                <p className="text-gray-400 text-center text-sm md:text-base mb-3 md:mb-4">Уворачивайся от врагов!</p>
                <div className="text-center">
                  <span className="inline-block px-3 py-1.5 md:px-4 md:py-2 bg-red-500/20 border border-red-500/30 text-red-400 text-xs md:text-sm">
                    До 50+ монет за игру
                  </span>
                </div>
              </div>

              {/* Clicker Game Card */}
              <div 
                className="card cursor-pointer hover:border-white/40 transition-all active:scale-95 md:hover:scale-105 p-4 md:p-8"
                onClick={() => setActiveGame('clicker')}
                data-testid="select-clicker"
              >
                <div className="w-16 h-16 md:w-20 md:h-20 mx-auto flex items-center justify-center bg-purple-500/20 border border-purple-500/30 rounded-lg mb-4 md:mb-6">
                  <span className="text-3xl md:text-4xl text-purple-400">⛧</span>
                </div>
                <h2 className="font-orbitron text-lg md:text-xl text-center mb-2 md:mb-3">КЛИКЕР</h2>
                <p className="text-gray-400 text-center text-sm md:text-base mb-3 md:mb-4">Кликай и копи монеты!</p>
                <div className="text-center">
                  <span className="inline-block px-3 py-1.5 md:px-4 md:py-2 bg-purple-500/20 border border-purple-500/30 text-purple-400 text-xs md:text-sm">
                    До 0.5 монет за клик
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        {activeGame === 'dodge' && (
          <div className="pt-8 md:pt-4">
            <button 
              onClick={() => setActiveGame(null)} 
              className="mb-4 md:mb-6 flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm md:text-base"
            >
              <ChevronRight size={16} className="rotate-180" /> Назад к играм
            </button>
            <DodgeGameInner />
          </div>
        )}

        {activeGame === 'clicker' && (
          <div className="pt-8 md:pt-4">
            <button 
              onClick={() => setActiveGame(null)} 
              className="mb-4 md:mb-6 flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm md:text-base"
            >
              <ChevronRight size={16} className="rotate-180" /> Назад к играм
            </button>
            <ClickerGameInner />
          </div>
        )}
      </div>
    </div>
  );
};

// ==================== SHOP ====================
const Shop = () => {
  const { user, token, refreshUser } = useAuth();
  const [purchasing, setPurchasing] = useState(false);

  const items = [
    { key: "custom_role", icon: Award, name: "Кастомная роль", desc: "Создай свою уникальную роль", price: 3000, needsName: true },
    { key: "custom_gradient", icon: Palette, name: "Градиент роли", desc: "Добавь градиент к своей роли", price: 4000, needsName: true },
    { key: "create_clan", icon: Users, name: "Создание клана", desc: "Основай свой собственный клан", price: 5000, needsName: true, disabled: !!user?.clan },
    { key: "clan_category", icon: FolderTree, name: "Категория клана", desc: "Добавь категорию для клана", price: 6000, needsName: false, disabled: !user?.clan || user?.clanCategory },
  ];

  const chestItems = [
    { type: "common", name: "Обычный сундук", desc: "10-150 монет", price: 85, color: "text-gray-400", bg: "bg-white/10", border: "border-white/30" },
    { type: "rare", name: "Редкий сундук", desc: "75-400 монет", price: 275, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" },
    { type: "epic", name: "Эпический сундук", desc: "200-1000 монет", price: 700, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/30" },
  ];

  const getDisabledText = (item) => {
    if (item.key === "create_clan") return "Уже есть клан";
    if (item.key === "clan_category") {
      if (!user?.clan) return "Сначала создайте клан";
      if (user?.clanCategory) return "Уже куплено";
    }
    return "Уже куплено";
  };

  const purchase = async (itemType, needsName, label) => {
    let itemName = null;
    if (needsName) {
      itemName = prompt(`Введите название для "${label}":`);
      if (!itemName) return;
    }
    setPurchasing(true);
    try {
      const res = await axios.post(`${API}/shop/purchase`, { itemType, itemName }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(`Куплено: ${res.data.purchase.item}!`);
      await refreshUser();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка покупки");
    } finally { setPurchasing(false); }
  };

  const buyChest = async (chestType) => {
    setPurchasing(true);
    try {
      await axios.post(`${API}/shop/buy-chest`, { chestType }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(`Сундук добавлен в инвентарь!`);
      await refreshUser();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка покупки");
    } finally { setPurchasing(false); }
  };

  return (
    <div className="min-h-screen pt-20 pb-24 md:pb-8 px-4 md:px-8" data-testid="shop-page">
      <div className="max-w-6xl mx-auto">
        <h1 className="font-orbitron text-2xl font-bold text-white tracking-wider mb-2 flex items-center gap-2">
          <ShoppingCart size={24} /> МАГАЗИН
        </h1>
        <p className="text-gray-500 font-rajdhani mb-4">Трать монеты на эксклюзивные предметы</p>
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 mb-8">
          <Coins size={16} className="text-yellow-400" />
          <span className="font-orbitron font-bold text-white">{user?.coins || 0}</span>
          <span className="text-gray-500">доступно</span>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          {items.map((item) => (
            <div key={item.key} className={`card relative ${item.disabled ? "opacity-50" : ""}`} data-testid={`shop-item-${item.key}`}>
              <div className="absolute top-4 right-4 flex items-center gap-1 px-3 py-1 bg-black/50 border border-white/10">
                <Coins size={12} className="text-yellow-400" />
                <span className="font-orbitron text-sm">{item.price}</span>
              </div>
              <div className="w-16 h-16 flex items-center justify-center bg-white/5 border border-white/10 mb-5">
                <item.icon size={32} className="text-white" strokeWidth={1} />
              </div>
              <div className="font-orbitron text-lg mb-2">{item.name}</div>
              <div className="text-gray-500 text-sm mb-5 min-h-[40px]">{item.desc}</div>
              {item.disabled ? (
                <div className="text-gray-500 text-sm">{getDisabledText(item)}</div>
              ) : (
                <button
                  onClick={() => purchase(item.key, item.needsName, item.name)}
                  disabled={purchasing || (user?.coins || 0) < item.price}
                  className="btn-secondary w-full"
                  data-testid={`buy-${item.key}`}
                >
                  {(user?.coins || 0) < item.price ? "НЕДОСТАТОЧНО" : "КУПИТЬ"}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Chests section */}
        <h2 className="font-orbitron text-xl font-bold text-white mt-12 mb-4 tracking-wider flex items-center gap-2">
          <Box size={20} /> СУНДУКИ
        </h2>
        <p className="text-gray-500 font-rajdhani mb-4">Купите сундук и откройте его в профиле</p>
        <div className="grid sm:grid-cols-3 gap-6 mb-12">
          {chestItems.map((chest) => (
            <div key={chest.type} className={`card relative ${chest.bg} ${chest.border}`} data-testid={`shop-chest-${chest.type}`}>
              <div className="absolute top-4 right-4 flex items-center gap-1 px-3 py-1 bg-black/50 border border-white/10">
                <Coins size={12} className="text-yellow-400" />
                <span className="font-orbitron text-sm">{chest.price}</span>
              </div>
              <div className={`w-16 h-16 flex items-center justify-center ${chest.bg} border ${chest.border} mb-5`}>
                <Box size={32} className={chest.color} />
              </div>
              <div className={`font-orbitron text-lg mb-2 ${chest.color}`}>{chest.name}</div>
              <div className="text-gray-500 text-sm mb-5">{chest.desc}</div>
              <button
                onClick={() => buyChest(chest.type)}
                disabled={purchasing || (user?.coins || 0) < chest.price}
                className="btn-secondary w-full"
                data-testid={`buy-chest-${chest.type}`}
              >
                {(user?.coins || 0) < chest.price ? "НЕДОСТАТОЧНО" : "КУПИТЬ"}
              </button>
            </div>
          ))}
        </div>

        <h2 className="font-orbitron text-xl font-bold text-white mb-4 tracking-wider flex items-center gap-2">
          <Package size={20} /> ВАШ ИНВЕНТАРЬ
        </h2>
        <div className="grid md:grid-cols-3 gap-6">
          <div className="card">
            <h3 className="font-orbitron text-sm mb-4 flex items-center gap-2"><Award size={16} /> РОЛИ ({user?.roles?.length || 0})</h3>
            {user?.roles?.length > 0 ? (
              <div className="flex flex-wrap gap-2">{user.roles.map((r, i) => <span key={i} className="px-3 py-1 bg-white/10 border border-white/20">{r}</span>)}</div>
            ) : <p className="text-gray-500">Пока нет</p>}
          </div>
          <div className="card">
            <h3 className="font-orbitron text-sm mb-4 flex items-center gap-2"><Palette size={16} /> ГРАДИЕНТЫ ({user?.roleGradients?.length || 0})</h3>
            {user?.roleGradients?.length > 0 ? (
              <div className="flex flex-wrap gap-2">{user.roleGradients.map((g, i) => <span key={i} className="px-3 py-1 bg-white/10 border border-white/20">{g}</span>)}</div>
            ) : <p className="text-gray-500">Пока нет</p>}
          </div>
          <div className="card">
            <h3 className="font-orbitron text-sm mb-4 flex items-center gap-2"><Users size={16} /> КЛАН</h3>
            {user?.clan ? (
              <div><p className="text-lg mb-2">{user.clan}</p><p className="text-gray-500">{user.clanCategory ? "Категория активна" : "Без категории"}</p></div>
            ) : <p className="text-gray-500">Пока нет</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

// ==================== LEADERBOARD ====================
const Leaderboard = () => {
  const { token } = useAuth();
  const [leaders, setLeaders] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadLeaderboard = async () => {
    try {
      const res = await axios.get(`${API}/leaderboard`, { headers: { Authorization: `Bearer ${token}` } });
      setLeaders(res.data);
    } catch (error) {
      toast.error("Ошибка загрузки лидерборда");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLeaderboard();
  }, []);

  const getMedalColor = (index) => {
    if (index === 0) return "text-yellow-400";
    if (index === 1) return "text-gray-300";
    if (index === 2) return "text-amber-600";
    return "text-gray-500";
  };

  return (
    <div className="main-content">
      <Navbar />
      <div className="page-container">
        <div className="text-center mb-8">
          <h1 className="font-orbitron text-2xl md:text-3xl font-bold tracking-wider flex items-center justify-center gap-3">
            <Trophy size={28} className="text-yellow-400" /> ЛИДЕРБОРД
          </h1>
          <p className="text-gray-400 mt-2 text-sm md:text-base">Топ игроков по количеству монет</p>
        </div>

        <div className="max-w-2xl mx-auto">
          {loading ? (
            <div className="text-center text-gray-400 py-12">Загрузка...</div>
          ) : leaders.length === 0 ? (
            <div className="text-center text-gray-400 py-12">Пока нет игроков в рейтинге</div>
          ) : (
            <div className="space-y-3">
              {leaders.map((player, index) => (
                <div 
                  key={player.id} 
                  className={`card flex items-center gap-4 p-4 ${index < 3 ? 'border-yellow-500/30' : ''}`}
                  data-testid={`leader-${index}`}
                >
                  <div className={`w-10 h-10 flex items-center justify-center font-orbitron text-xl font-bold ${getMedalColor(index)}`}>
                    {index < 3 ? (
                      <Trophy size={24} />
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-orbitron text-white truncate">{player.username}</div>
                    <div className="text-gray-500 text-sm">Уровень {player.level}</div>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/30">
                    <Coins size={16} className="text-yellow-400" />
                    <span className="font-orbitron text-yellow-400">{player.coins}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button 
            onClick={loadLeaderboard}
            className="btn-secondary w-full mt-6 flex items-center justify-center gap-2"
          >
            <RefreshCw size={16} /> ОБНОВИТЬ
          </button>
        </div>
      </div>
    </div>
  );
};

// ==================== TRANSFER ====================
const Transfer = () => {
  const { user, token, refreshUser } = useAuth();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const handleTransfer = async (e) => {
    e.preventDefault();
    if (!recipient.trim()) { toast.error("Введите имя получателя"); return; }
    if (!amount || parseInt(amount) <= 0) { toast.error("Введите корректную сумму"); return; }
    if (parseInt(amount) > (user?.coins || 0)) { toast.error("Недостаточно монет"); return; }

    setLoading(true);
    try {
      const res = await axios.post(`${API}/transfer`, { toUsername: recipient.trim(), amount: parseInt(amount) }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(`Переведено ${res.data.transferred} монет → ${res.data.to}`);
      setRecipient("");
      setAmount("");
      await refreshUser();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка перевода");
    } finally { setLoading(false); }
  };

  const maxAmount = user?.coins || 0;

  return (
    <div className="min-h-screen pt-20 pb-24 md:pb-8 px-4 md:px-8" data-testid="transfer-page">
      <div className="max-w-xl mx-auto">
        <h1 className="font-orbitron text-2xl font-bold text-white tracking-wider mb-2 flex items-center gap-2">
          <ArrowLeftRight size={24} /> ПЕРЕВОД
        </h1>
        <p className="text-gray-500 font-rajdhani mb-8">Отправляй монеты другим игрокам</p>

        <div className="card mb-8 flex items-center justify-between">
          <div>
            <div className="label-text mb-2">Ваш баланс</div>
            <div className="font-orbitron text-4xl font-bold text-white flex items-center gap-3">
              <Coins size={32} className="text-yellow-400" />
              {user?.coins || 0}
            </div>
          </div>
          <div className="w-16 h-16 flex items-center justify-center bg-yellow-500/10 border border-yellow-500/30">
            <Coins size={32} className="text-yellow-400" />
          </div>
        </div>

        <div className="card">
          <h2 className="font-orbitron text-lg mb-6 flex items-center gap-2">
            <Send size={18} /> ОТПРАВИТЬ МОНЕТЫ
          </h2>
          <form onSubmit={handleTransfer} className="space-y-6">
            <div>
              <label className="label-text">Получатель</label>
              <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="input-field" placeholder="Имя пользователя" data-testid="transfer-recipient" />
            </div>
            <div>
              <label className="label-text">Сумма</label>
              <div className="input-with-icon">
                <span className="input-icon"><Coins size={16} /></span>
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-field" placeholder="0" min="1" max={maxAmount} data-testid="transfer-amount" />
              </div>
              <p className="text-gray-500 text-sm mt-2">Максимум: {maxAmount} монет</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {[100, 500, 1000].filter(v => v <= maxAmount).map(v => (
                <button key={v} type="button" onClick={() => setAmount(v.toString())} className="px-4 py-2 bg-white/5 border border-white/10 text-white hover:border-white/30 transition-colors flex items-center gap-1">
                  <Coins size={12} /> {v}
                </button>
              ))}
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2" data-testid="transfer-btn">
              <Send size={18} /> {loading ? "ОТПРАВКА..." : "ОТПРАВИТЬ"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

// ==================== PROFILE ====================
const Profile = () => {
  const { user } = useAuth();
  const purchases = user?.purchaseHistory || [];

  const getXpProgress = () => {
    let level = 1, xpForNext = 100, remainingXp = user?.xp || 0;
    while (level < user?.level && level < 100) { remainingXp -= xpForNext; level++; xpForNext = Math.floor(xpForNext * 1.15); }
    return { current: Math.max(0, remainingXp), needed: xpForNext, percentage: Math.min((remainingXp / xpForNext) * 100, 100) };
  };

  const xpProgress = getXpProgress();

  return (
    <div className="min-h-screen pt-20 pb-24 md:pb-8 px-4 md:px-8" data-testid="profile-page">
      <div className="max-w-5xl mx-auto">
        <h1 className="font-orbitron text-2xl font-bold text-white tracking-wider mb-8 flex items-center gap-2">
          <User size={24} /> ПРОФИЛЬ
        </h1>

        <div className="card mb-8">
          <div className="flex flex-col md:flex-row gap-8">
            <div className="w-32 h-32 bg-white/10 border border-white/20 flex items-center justify-center flex-shrink-0 mx-auto md:mx-0">
              <User size={64} className="text-white" strokeWidth={1} />
            </div>
            <div className="flex-1 text-center md:text-left">
              <div className="font-orbitron text-2xl mb-2 flex items-center justify-center md:justify-start gap-3">
                {user?.username}
                {user?.isAdmin && <span className="admin-badge">АДМИН</span>}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                <div className="p-4 bg-black/30 border border-white/10">
                  <div className="label-text flex items-center gap-1"><TrendingUp size={12} /> Уровень</div>
                  <div className="font-orbitron text-2xl font-bold">{user?.level || 1}</div>
                </div>
                <div className="p-4 bg-black/30 border border-white/10">
                  <div className="label-text flex items-center gap-1"><Star size={12} /> Всего XP</div>
                  <div className="font-orbitron text-2xl font-bold">{user?.xp || 0}</div>
                </div>
                <div className="p-4 bg-black/30 border border-white/10">
                  <div className="label-text flex items-center gap-1"><Coins size={12} /> Монеты</div>
                  <div className="font-orbitron text-2xl font-bold text-yellow-400">{user?.coins || 0}</div>
                </div>
                <div className="p-4 bg-black/30 border border-white/10">
                  <div className="label-text flex items-center gap-1"><ShoppingCart size={12} /> Покупки</div>
                  <div className="font-orbitron text-2xl font-bold">{purchases.length}</div>
                </div>
              </div>
              <div className="mt-6">
                <div className="flex justify-between mb-1">
                  <span className="label-text">Прогресс до уровня {Math.min((user?.level || 1) + 1, 100)}</span>
                  <span className="text-gray-500 text-sm">{xpProgress.current} / {xpProgress.needed} XP</span>
                </div>
                <div className="progress-bar h-2"><div className="progress-fill" style={{ width: `${xpProgress.percentage}%` }} /></div>
              </div>
            </div>
          </div>
        </div>

        <h2 className="font-orbitron text-xl font-bold text-white mb-4 tracking-wider flex items-center gap-2">
          <History size={20} /> ИСТОРИЯ ПОКУПОК
        </h2>
        <div className="card overflow-x-auto">
          {purchases.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Предмет</th>
                  <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Название</th>
                  <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Цена</th>
                  <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Дата</th>
                  <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Время</th>
                </tr>
              </thead>
              <tbody>
                {[...purchases].reverse().map((p, i) => (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-4 px-4">{p.item}</td>
                    <td className="py-4 px-4 text-gray-400">{p.itemName || "-"}</td>
                    <td className="py-4 px-4 text-yellow-400 font-orbitron flex items-center gap-1"><Coins size={12} /> {p.price}</td>
                    <td className="py-4 px-4 text-gray-400">{p.date}</td>
                    <td className="py-4 px-4 text-gray-400">{p.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-12">
              <ShoppingCart size={48} className="mx-auto mb-4 text-gray-600" strokeWidth={1} />
              <p className="text-gray-500">Пока нет покупок</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ==================== ADMIN ====================
const AdminPanel = () => {
  const { user, token, refreshUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [targetUsername, setTargetUsername] = useState("");
  const [coinsAmount, setCoinsAmount] = useState("");
  const [chestTarget, setChestTarget] = useState("");
  const [chestType, setChestType] = useState("common");
  const [chestCount, setChestCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [isCreator, setIsCreator] = useState(false);

  const loadUsers = async () => {
    try {
      const res = await axios.get(`${API}/admin/users`, { headers: { Authorization: `Bearer ${token}` } });
      setUsers(res.data);
    } catch (error) {
      toast.error("Ошибка загрузки");
    }
  };

  const checkIsCreator = async () => {
    try {
      const res = await axios.get(`${API}/admin/is-creator`, { headers: { Authorization: `Bearer ${token}` } });
      setIsCreator(res.data.isCreator);
    } catch (error) {
      setIsCreator(false);
    }
  };

  useEffect(() => { 
    loadUsers(); 
    checkIsCreator();
  }, []);

  const handleAddCoins = async (e) => {
    e.preventDefault();
    if (!targetUsername.trim()) { toast.error("Введите имя"); return; }
    const amount = parseInt(coinsAmount);
    if (!amount || amount <= 0) { toast.error("Введите сумму"); return; }
    if (amount > 10000) { toast.error("Максимум 10,000 монет за раз"); return; }

    setLoading(true);
    try {
      const res = await axios.post(`${API}/admin/add-coins`, { targetUsername: targetUsername.trim(), amount }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(`+${res.data.addedCoins} монет → ${res.data.toUser}`);
      setTargetUsername("");
      setCoinsAmount("");
      loadUsers();
      if (targetUsername.trim().toLowerCase() === user?.username.toLowerCase()) await refreshUser();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка");
    } finally { setLoading(false); }
  };

  const handleGiveChest = async (e) => {
    e.preventDefault();
    if (!chestTarget.trim()) { toast.error("Введите имя"); return; }
    if (chestCount < 1 || chestCount > 3) { toast.error("Максимум 3 сундука за раз"); return; }

    setLoading(true);
    try {
      // Give multiple chests
      for (let i = 0; i < chestCount; i++) {
        await axios.post(`${API}/admin/give-chest`, { targetUsername: chestTarget.trim(), chestType }, { headers: { Authorization: `Bearer ${token}` } });
      }
      toast.success(`${chestCount} сундук(ов) выдано → ${chestTarget.trim()}`);
      setChestTarget("");
      setChestCount(1);
      loadUsers();
      if (chestTarget.trim().toLowerCase() === user?.username.toLowerCase()) await refreshUser();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка");
    } finally { setLoading(false); }
  };

  const handleBan = async (username) => {
    if (!window.confirm(`Забанить пользователя ${username}?`)) return;
    try {
      const res = await axios.post(`${API}/admin/ban`, { targetUsername: username }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(res.data.message);
      loadUsers();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка");
    }
  };

  const handleUnban = async (username) => {
    if (!window.confirm(`Разбанить пользователя ${username}?`)) return;
    try {
      const res = await axios.post(`${API}/admin/unban`, { targetUsername: username }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(res.data.message);
      loadUsers();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка");
    }
  };

  const handleSetAdmin = async (username) => {
    if (!window.confirm(`Назначить ${username} администратором?`)) return;
    const creatorPassword = window.prompt("Введите пароль создателя:");
    if (!creatorPassword) return;
    try {
      const res = await axios.post(`${API}/admin/set-admin`, { targetUsername: username, creatorPassword }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(res.data.message);
      loadUsers();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка");
    }
  };

  const handleRemoveAdmin = async (username) => {
    if (!window.confirm(`Снять ${username} с поста администратора?`)) return;
    const creatorPassword = window.prompt("Введите пароль создателя:");
    if (!creatorPassword) return;
    try {
      const res = await axios.post(`${API}/admin/remove-admin`, { targetUsername: username, creatorPassword }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(res.data.message);
      loadUsers();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка");
    }
  };

  const quickAdd = (amount) => {
    setTargetUsername(user?.username || "");
    setCoinsAmount(amount.toString());
  };

  const quickChest = (type) => {
    setChestTarget(user?.username || "");
    setChestType(type);
  };

  if (!user?.isAdmin) return <Navigate to="/dashboard" />;

  return (
    <div className="min-h-screen pt-20 pb-24 md:pb-8 px-4 md:px-8" data-testid="admin-page">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 bg-red-500/20 border border-red-500/30 flex items-center justify-center">
            <Shield size={24} className="text-red-400" />
          </div>
          <div>
            <h1 className="font-orbitron text-2xl font-bold text-white tracking-wider">ПАНЕЛЬ АДМИНИСТРАТОРА</h1>
            <p className="text-gray-500">Управление пользователями</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Add Coins */}
          <div className="card">
            <h2 className="font-orbitron text-lg mb-6 flex items-center gap-2">
              <Plus size={18} /> ДОБАВИТЬ МОНЕТЫ
            </h2>
            <form onSubmit={handleAddCoins} className="space-y-4">
              <div>
                <label className="label-text">Имя пользователя</label>
                <input type="text" value={targetUsername} onChange={(e) => setTargetUsername(e.target.value)} className="input-field" placeholder="Введите имя" data-testid="admin-target-username" />
              </div>
              <div>
                <label className="label-text">Сумма</label>
                <div className="input-with-icon">
                  <span className="input-icon"><Coins size={14} /></span>
                  <input type="number" value={coinsAmount} onChange={(e) => setCoinsAmount(e.target.value)} className="input-field" placeholder="0" min="1" data-testid="admin-coins-amount" />
                </div>
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2" data-testid="admin-add-coins-btn">
                <Plus size={16} /> {loading ? "..." : "ДОБАВИТЬ"}
              </button>
            </form>
            <div className="mt-4 pt-4 border-t border-white/10">
              <p className="text-gray-500 text-sm mb-3">Быстро себе:</p>
              <div className="flex flex-wrap gap-2">
                {[100, 500, 1000, 5000].map(v => (
                  <button key={v} onClick={() => quickAdd(v)} className="px-3 py-1.5 bg-white/5 border border-white/10 text-white hover:border-white/30 transition-colors text-sm">
                    +{v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Give Chest */}
          <div className="card">
            <h2 className="font-orbitron text-lg mb-6 flex items-center gap-2">
              <Package size={18} /> ВЫДАТЬ СУНДУК
            </h2>
            <form onSubmit={handleGiveChest} className="space-y-4">
              <div>
                <label className="label-text">Имя пользователя</label>
                <input type="text" value={chestTarget} onChange={(e) => setChestTarget(e.target.value)} className="input-field" placeholder="Введите имя" data-testid="admin-chest-target" />
              </div>
              <div>
                <label className="label-text">Тип сундука</label>
                <select value={chestType} onChange={(e) => setChestType(e.target.value)} className="input-field" data-testid="admin-chest-type">
                  <option value="common">Обычный (10-150 монет)</option>
                  <option value="rare">Редкий (75-400 монет)</option>
                  <option value="epic">Эпический (200-1000 монет)</option>
                </select>
              </div>
              <div>
                <label className="label-text">Количество (макс. 3)</label>
                <input type="number" min="1" max="3" value={chestCount} onChange={(e) => setChestCount(Math.min(3, Math.max(1, parseInt(e.target.value) || 1)))} className="input-field" data-testid="admin-chest-count" />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2" data-testid="admin-give-chest-btn">
                <Package size={16} /> {loading ? "..." : "ВЫДАТЬ"}
              </button>
            </form>
            <div className="mt-4 pt-4 border-t border-white/10">
              <p className="text-gray-500 text-sm mb-3">Быстро себе:</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { type: "common", label: "Обычный", color: "text-gray-400" },
                  { type: "rare", label: "Редкий", color: "text-blue-400" },
                  { type: "epic", label: "Эпический", color: "text-purple-400" },
                ].map(c => (
                  <button key={c.type} onClick={() => quickChest(c.type)} className={`px-3 py-1.5 bg-white/5 border border-white/10 hover:border-white/30 transition-colors text-sm ${c.color}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Users Table */}
        <div className="card">
          <div className="flex justify-between items-center mb-6">
            <h2 className="font-orbitron text-lg flex items-center gap-2">
              <Users size={18} /> ВСЕ ПОЛЬЗОВАТЕЛИ
            </h2>
            <button onClick={loadUsers} className="btn-secondary flex items-center gap-2">
              <RefreshCw size={14} /> ОБНОВИТЬ
            </button>
          </div>
          <p className="text-gray-500 text-sm mb-4">Все админы могут банить/разбанивать. Только создатель может назначать админов.</p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Имя</th>
                  <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Уровень</th>
                  <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Монеты</th>
                  <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Сундуки</th>
                  <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Роли</th>
                  <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Клан</th>
                  <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Действия</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => {
                  const isUserCreator = u.username.toLowerCase() === "pseudotamine";
                  return (
                    <tr key={u.id} className="border-b border-white/5 hover:bg-white/5" data-testid={`user-row-${i}`}>
                      <td className="py-4 px-4">
                        {u.username}
                        {isUserCreator && <span className="ml-2 px-2 py-0.5 text-xs bg-purple-500/20 border border-purple-500 text-purple-400 uppercase">Создатель</span>}
                        {u.isAdmin && !isUserCreator && <span className="admin-badge ml-2">АДМИН</span>}
                        {u.isBanned && <span className="ml-2 px-2 py-0.5 text-xs bg-red-500/40 border border-red-500 text-red-400 uppercase">Забанен</span>}
                      </td>
                      <td className="py-4 px-4 font-orbitron">{u.level}</td>
                      <td className="py-4 px-4 font-orbitron text-yellow-400 flex items-center gap-1">
                        <Coins size={12} /> {u.coins}
                      </td>
                      <td className="py-4 px-4 text-gray-400">{u.chests?.length || 0}</td>
                      <td className="py-4 px-4 text-gray-400">{u.roles?.length || 0}</td>
                      <td className="py-4 px-4 text-gray-400">{u.clan || "-"}</td>
                      <td className="py-4 px-4">
                        {!isUserCreator ? (
                          <div className="flex flex-wrap gap-2">
                            {!u.isBanned ? (
                              <button onClick={() => handleBan(u.username)} className="px-3 py-1 text-xs bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30 transition-colors">
                                Бан
                              </button>
                            ) : (
                              <button onClick={() => handleUnban(u.username)} className="px-3 py-1 text-xs bg-green-500/20 border border-green-500/50 text-green-400 hover:bg-green-500/30 transition-colors">
                                Разбан
                              </button>
                            )}
                            {isCreator && !u.isBanned && (
                              u.isAdmin ? (
                                <button onClick={() => handleRemoveAdmin(u.username)} className="px-3 py-1 text-xs bg-yellow-500/20 border border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/30 transition-colors">
                                  Снять админа
                                </button>
                              ) : (
                                <button onClick={() => handleSetAdmin(u.username)} className="px-3 py-1 text-xs bg-blue-500/20 border border-blue-500/50 text-blue-400 hover:bg-blue-500/30 transition-colors">
                                  Назначить админом
                                </button>
                              )
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// ==================== PROTECTED ROUTE ====================
const ProtectedRoute = ({ children, adminOnly = false }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-[#050505]"><div className="text-white font-orbitron text-xl animate-pulse">Загрузка...</div></div>;
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (adminOnly && !user.isAdmin) return <Navigate to="/dashboard" replace />;
  return children;
};

// ==================== APP ====================
function AppContent() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const isAuthPage = ["/login", "/register"].includes(location.pathname);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-[#050505]"><div className="text-white font-orbitron text-xl animate-pulse">Загрузка...</div></div>;
  }

  return (
    <div className="min-h-screen bg-[#050505]">
      {user && !isAuthPage && <Navbar />}
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <Login />} />
        <Route path="/register" element={user ? <Navigate to="/dashboard" /> : <Register />} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/games" element={<ProtectedRoute><GamesHub /></ProtectedRoute>} />
        <Route path="/shop" element={<ProtectedRoute><Shop /></ProtectedRoute>} />
        <Route path="/leaderboard" element={<ProtectedRoute><Leaderboard /></ProtectedRoute>} />
        <Route path="/transfer" element={<ProtectedRoute><Transfer /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute adminOnly><AdminPanel /></ProtectedRoute>} />
        <Route path="/" element={<Navigate to={user ? "/dashboard" : "/login"} />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
        <Toaster position="top-right" theme="dark" toastOptions={{ style: { background: "#121212", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontFamily: "Rajdhani, sans-serif" } }} />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
