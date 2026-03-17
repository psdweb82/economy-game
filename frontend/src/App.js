import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, Link } from "react-router-dom";
import axios from "axios";
import { Toaster, toast } from "sonner";
import { 
  Home, Gamepad2, ShoppingCart, ArrowLeftRight, User, Shield, LogOut, 
  Coins, TrendingUp, Award, Users, Sun, Star, Package, Gift, 
  Send, Plus, RefreshCw, Eye, EyeOff, ChevronRight, Play, RotateCcw,
  Palette, FolderTree, Search, Clock, History, Box, Trophy, Trash2,
  Check, X, UserCheck
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
    // DO NOT login automatically - user must login manually after registration
    return res.data; // Returns {success: true, message: "...", username: "..."}
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
      const res = await register(username, password);
      toast.success(res.message || "Аккаунт создан! Теперь войдите в систему");
      // Redirect to login page instead of dashboard
      navigate("/login");
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
            { to: "/games", icon: Gamepad2, title: "ИГРАТЬ", desc: "Фармить монеты" },
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
    paused: false,
    pausedTime: 0,
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
    g.paused = false;
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
      if (!g.running || g.paused) return;
      spawnEnemy();
      // Decrease spawn rate as score increases
      spawnRate = Math.max(400, 1200 - g.score * 15);
      g.spawnInterval = setTimeout(scheduleSpawn, spawnRate);
    };
    g.spawnInterval = setTimeout(scheduleSpawn, 500);

    // Game loop
    const loop = () => {
      if (!g.running || g.paused) return;
      
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
    
    // Ensure we're actually ending a running game
    if (!g.running && gameState !== "playing") return;
    
    g.running = false;
    g.paused = false; // Clear pause state
    clearTimeout(g.spawnInterval);
    cancelAnimationFrame(g.animationId);

    const finalScore = g.score;
    // Calculate actual playing time (excluding paused periods)
    const timePlayedSeconds = Math.floor((Date.now() - g.startTime) / 1000);
    setGameState("ended");

    if (finalScore > highScore) setHighScore(finalScore);

    try {
      const res = await axios.post(`${API}/game/submit`, { score: finalScore, timePlayedSeconds }, { headers: { Authorization: `Bearer ${token}` } });
      setLastResult(res.data);
      await refreshUser();
      
      // Check if win is pending approval
      if (res.data.pending) {
        toast.success(`Ваш выигрыш ожидает одобрения администрации`, { duration: 5000 });
      } else {
        toast.success(`+${res.data.coinsEarned} монет, +${res.data.xpEarned} XP!`);
      }
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

  // Page Visibility API - pause game when tab is hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      const g = gameRef.current;
      if (!g.running) return;
      
      if (document.hidden) {
        // Tab became hidden - pause the game
        g.paused = true;
        g.pausedTime = Date.now();
        
        // Stop spawn interval
        if (g.spawnInterval) {
          clearTimeout(g.spawnInterval);
          g.spawnInterval = null;
        }
        
        // Cancel animation frame
        if (g.animationId) {
          cancelAnimationFrame(g.animationId);
          g.animationId = null;
        }
      } else {
        // Tab became visible - resume the game
        if (g.paused) {
          g.paused = false;
          
          // Adjust start time to account for paused duration
          const pauseDuration = Date.now() - g.pausedTime;
          g.startTime += pauseDuration;
          
          // Clear any existing enemies to prevent spam
          g.enemies = [];
          
          // Restart spawn interval
          let spawnRate = Math.max(400, 1200 - g.score * 15);
          const scheduleSpawn = () => {
            if (!g.running || g.paused) return;
            
            // Spawn enemy logic (inlined to avoid dependency issues)
            const player = g.player;
            const targetPlayer = Math.random() < 0.7;
            let x, vx, vy;
            
            if (targetPlayer) {
              x = Math.random() * 600;
              const dx = player.x - x;
              const dy = player.y + 50;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const baseSpeed = (2 + Math.random() * 2) * g.speedMultiplier;
              vx = (dx / dist) * baseSpeed * 0.5;
              vy = (dy / dist) * baseSpeed;
            } else {
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
            
            spawnRate = Math.max(400, 1200 - g.score * 15);
            g.spawnInterval = setTimeout(scheduleSpawn, spawnRate);
          };
          g.spawnInterval = setTimeout(scheduleSpawn, spawnRate);
          
          // Resume game loop (main loop will continue via startGame)
          const canvas = canvasRef.current;
          const resumeLoop = () => {
            if (!g.running || g.paused) return;
            
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

            // Constrain player
            g.player.x = Math.max(g.player.size, Math.min(600 - g.player.size, g.player.x));
            g.player.y = Math.max(g.player.size, Math.min(400 - g.player.size, g.player.y));

            // Speed increases
            if (g.score >= 50) g.speedMultiplier = 1.5;
            if (g.score >= 100) g.speedMultiplier = 2;
            if (g.score >= 150) g.speedMultiplier = 2.5;

            // Update enemies
            let collision = false;
            g.enemies = g.enemies.filter((e) => {
              e.x += e.vx;
              e.y += e.vy;
              
              if (e.x < e.size/2 || e.x > 600 - e.size/2) e.vx *= -1;
              
              const dx = g.player.x - e.x;
              const dy = g.player.y - e.y;
              if (Math.sqrt(dx * dx + dy * dy) < (g.player.size + e.size) / 2) {
                collision = true;
              }
              
              if (e.y > 420) {
                g.score++;
                setScore(g.score);
                return false;
              }
              return true;
            });

            // Draw
            if (canvas) {
              const ctx = canvas.getContext("2d");
              ctx.fillStyle = "#050505";
              ctx.fillRect(0, 0, 600, 400);
              ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
              ctx.lineWidth = 1;
              for (let i = 0; i < 600; i += 30) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 400); ctx.stroke(); }
              for (let i = 0; i < 400; i += 30) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(600, i); ctx.stroke(); }

              g.enemies.forEach((e) => {
                ctx.fillStyle = "rgba(239, 68, 68, 0.9)";
                ctx.shadowColor = "#EF4444";
                ctx.shadowBlur = 15;
                ctx.fillRect(e.x - e.size/2, e.y - e.size/2, e.size, e.size);
              });

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
              g.animationId = requestAnimationFrame(resumeLoop);
            }
          };
          g.animationId = requestAnimationFrame(resumeLoop);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

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

// ==================== CRASH GAME ====================
const CrashGameInner = () => {
  const { user, token, refreshUser } = useAuth();
  const [betAmount, setBetAmount] = useState(100);
  const [gameState, setGameState] = useState("idle"); // idle, playing, crashed
  const [multiplier, setMultiplier] = useState(1.0);
  const [result, setResult] = useState(null);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef(null);
  const gameRef = useRef({ 
    running: false, 
    startTime: 0, 
    crashPoint: 0, 
    crashTime: 0,
    path: [],
    currentMultiplier: 1.0,
    lastChange: 0
  });

  const quickBets = [100, 500, 1000, 3000, 5000];

  const startGame = async () => {
    if (betAmount < 10 || betAmount > 50000) {
      toast.error("Ставка от 10 до 50000 монет");
      return;
    }

    if ((user?.coins || 0) < betAmount) {
      toast.error("Недостаточно монет!");
      return;
    }

    setPlaying(true);
    setResult(null);

    try {
      const res = await axios.post(`${API}/crash/play`, { betAmount }, { headers: { Authorization: `Bearer ${token}` } });
      
      // Start animation
      setGameState("playing");
      setMultiplier(1.0);
      
      const g = gameRef.current;
      g.running = true;
      g.startTime = Date.now();
      g.crashPoint = res.data.crashMultiplier;
      g.crashTime = res.data.crashTime * 1000; // Convert to ms
      g.path = [{x: 0, y: 1.0}];
      g.currentMultiplier = 1.0;

      // Animate graph with smooth random movement
      // Use setInterval for stable animation even when tab is hidden
      const intervalId = setInterval(() => {
        if (!g.running) {
          clearInterval(intervalId);
          return;
        }

        const elapsed = Date.now() - g.startTime;
        const progress = Math.min(elapsed / g.crashTime, 1);

        // UNPREDICTABLE MOVEMENT - like real casino!
        // Graph moves randomly until the very end
        
        if (progress < 0.85) {
          // First 85% - completely random movement
          // Can go up and down, making it impossible to predict
          const randomChange = (Math.random() - 0.5) * 0.4; // Bigger random jumps
          let newMultiplier = g.currentMultiplier + randomChange;
          
          // Add some momentum - if going up, tend to keep going up (and vice versa)
          const momentum = g.lastChange || 0;
          newMultiplier += momentum * 0.3;
          g.lastChange = randomChange;
          
          // Randomly jump between 0.3x and 3x during this phase
          newMultiplier = Math.max(0.3, Math.min(3, newMultiplier));
          
          g.currentMultiplier = newMultiplier;
        } else {
          // Last 15% - dramatic move to final result!
          // This is where the "surprise" happens
          const endProgress = (progress - 0.85) / 0.15; // 0 to 1 in last 15%
          
          // Smooth transition to actual crash point
          const targetMultiplier = g.crashPoint;
          g.currentMultiplier = g.currentMultiplier + (targetMultiplier - g.currentMultiplier) * endProgress * 0.5;
        }
        
        // Add point less frequently for smoother line (every 50ms worth of progress)
        if (g.path.length === 0 || elapsed - (g.path[g.path.length - 1].time || 0) > 50) {
          g.path.push({ x: progress, y: g.currentMultiplier, time: elapsed });
        }

        // Update display
        setMultiplier(g.currentMultiplier);

        // Draw graph
        drawGraph(g.path, progress);

        if (progress >= 1) {
          // Crash!
          clearInterval(intervalId);
          g.running = false;
          g.currentMultiplier = g.crashPoint;
          setMultiplier(g.crashPoint);
          setGameState("crashed");
          setPlaying(false);

          // Complete the game on backend
          (async () => {
            try {
              const completeRes = await axios.post(`${API}/crash/complete`, {}, { headers: { Authorization: `Bearer ${token}` } });
              setResult(completeRes.data);
              refreshUser();

              // Check if win is pending approval
              if (completeRes.data.pending) {
                toast.success(`Ваш выигрыш на рассмотрении администрации, ожидайте начисления`, { duration: 5000 });
              } else if (completeRes.data.won === true) {
                toast.success(`ВЫИГРЫШ! ${completeRes.data.crashMultiplier}x = +${completeRes.data.profit} монет!`, { duration: 5000 });
              } else if (completeRes.data.won === false) {
                toast.error(`ПРОИГРЫШ! ${completeRes.data.crashMultiplier}x`, { duration: 3000 });
              } else {
                toast.info(`ПОЗДРАВЛЯЕМ! ${completeRes.data.crashMultiplier}x - ставка возвращена`, { duration: 3000 });
              }
            } catch (error) {
              toast.error("Ошибка завершения игры");
            }
          })();
        }
      }, 50); // setInterval runs every 50ms
    } catch (error) {
      const errorMsg = error.response?.data?.detail || "Ошибка";
      toast.error(errorMsg);
      setPlaying(false);
      setGameState("idle");
    }
  };

  const drawGraph = (path, progress) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, width, height);
    
    // Grid lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const y = (height / 10) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    for (let i = 0; i <= 10; i++) {
      const x = (width / 10) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    
    if (path.length < 2) return;
    
    // Find min/max for scaling
    const minY = Math.min(...path.map(p => p.y));
    const maxY = Math.max(...path.map(p => p.y));
    const yRange = maxY - minY || 1;
    const yPadding = yRange * 0.15;
    
    // Convert to canvas coordinates
    const points = path.map(point => {
      const x = point.x * width;
      const normalizedY = (point.y - minY + yPadding) / (yRange + 2 * yPadding);
      const y = height - (normalizedY * height);
      return { x, y, originalY: point.y };
    });
    
    // Line color
    const lineColor = progress >= 1 
      ? (gameRef.current.crashPoint >= 1.0 ? "#10b981" : "#ef4444")
      : "#fbbf24";
    
    // Draw gradient fill under the line (ONLY up to current position)
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, lineColor + "40");
    gradient.addColorStop(1, lineColor + "00");
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(points[0].x, height);
    
    // Smooth curve through points
    for (let i = 0; i < points.length - 1; i++) {
      const current = points[i];
      const next = points[i + 1];
      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;
      
      if (i === 0) {
        ctx.lineTo(current.x, current.y);
      }
      ctx.quadraticCurveTo(current.x, current.y, midX, midY);
    }
    
    const lastPoint = points[points.length - 1];
    ctx.lineTo(lastPoint.x, lastPoint.y);
    
    // Close gradient path at CURRENT position (not at right edge)
    ctx.lineTo(lastPoint.x, height);
    ctx.lineTo(points[0].x, height);
    ctx.closePath();
    ctx.fill();
    
    // Draw main curve line
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = lineColor;
    ctx.shadowBlur = 8;
    
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    
    for (let i = 0; i < points.length - 1; i++) {
      const current = points[i];
      const next = points[i + 1];
      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;
      ctx.quadraticCurveTo(current.x, current.y, midX, midY);
    }
    
    // End at last point
    ctx.lineTo(lastPoint.x, lastPoint.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
    
    // Draw circle at current position
    ctx.fillStyle = lineColor;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 3;
    
    ctx.beginPath();
    ctx.arc(lastPoint.x, lastPoint.y, 8, 0, Math.PI * 2);
    ctx.fill();
    
    // Outer glow ring
    ctx.shadowColor = lineColor;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(lastPoint.x, lastPoint.y, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  const resetGame = () => {
    gameRef.current.running = false;
    setGameState("idle");
    setMultiplier(1.0);
    setResult(null);
    
    // Clear canvas
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#050505";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  };

  return (
    <div className="pb-24 md:pb-8">
      <div className="text-center mb-8 md:mb-10 mt-6 md:mt-8">
        <h1 className="font-orbitron text-xl md:text-2xl font-bold tracking-wider flex items-center justify-center gap-3">
          <TrendingUp size={28} /> CRASH ИГРА
        </h1>
        <p className="text-gray-400 mt-3 text-sm md:text-base">Ставь и угадывай множитель!</p>
      </div>

      {/* Game Display */}
      <div className="card p-4 md:p-8 mb-6 md:mb-8 text-center">
        <div className="relative mx-auto max-w-2xl">
          {/* Multiplier Display */}
          <div className={`mb-6 ${gameState === "playing" ? "animate-pulse" : ""}`}>
            <div className={`font-orbitron text-5xl md:text-7xl font-bold transition-all duration-300 ${
              gameState === "crashed" 
                ? (result?.won === true ? "text-green-400" : result?.won === false ? "text-red-400" : "text-yellow-400")
                : "text-white"
            }`}>
              {multiplier.toFixed(2)}x
            </div>
          </div>

          {/* Canvas for Graph */}
          <div className="mb-6 flex justify-center">
            <canvas 
              ref={canvasRef} 
              width={600} 
              height={300}
              className="border border-white/10 rounded-lg"
              style={{ maxWidth: "100%", width: "600px", height: "300px" }}
            />
          </div>
          
          {gameState === "idle" && (
            <div className="text-gray-500 mb-6">Сделайте ставку для начала</div>
          )}
          
          {gameState === "playing" && (
            <div className="text-yellow-400 mb-6 animate-pulse">Стрелка движется...</div>
          )}
          
          {gameState === "crashed" && result && (
            <div className="mb-6 space-y-3">
              <div className={`text-xl font-bold ${
                result.won === true ? "text-green-400" : 
                result.won === false ? "text-red-400" : 
                "text-yellow-400"
              }`}>
                {result.won === true ? "ВЫИГРЫШ!" : result.won === false ? "ПРОИГРЫШ!" : "ПОЗДРАВЛЯЕМ!"}
              </div>
              <div className="text-white">
                <div>Выигрыш: {result.betAmount} </div>
                {result.won === true && <div className="text-green-400">Выигрыш: {result.winAmount} монет</div>}
                {result.won === null && <div className="text-yellow-400">Возврат: {result.betAmount} монет</div>}
                <div className={result.profit > 0 ? "text-green-400" : result.profit < 0 ? "text-red-400" : "text-yellow-400"}>
                  {result.profit > 0 ? "+" : ""}{result.profit} монет
                </div>
              </div>
              <button onClick={resetGame} className="btn-primary mt-4">
                <RotateCcw size={18} /> ИГРАТЬ СНОВА
              </button>
            </div>
          )}

          {/* Bet Controls */}
          {gameState === "idle" && (
            <div className="space-y-6">
              {/* Quick Bet Buttons */}
              <div className="grid grid-cols-5 gap-2">
                {quickBets.map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setBetAmount(amount)}
                    className={`px-2 py-2 text-xs md:text-sm font-orbitron border transition-all ${
                      betAmount === amount 
                        ? "bg-white text-black border-white" 
                        : "bg-white/10 border-white/20 hover:bg-white/20"
                    }`}
                    data-testid={`quick-bet-${amount}`}
                  >
                    {amount}
                  </button>
                ))}
              </div>

              {/* Custom Bet Input */}
              <div>
                <label className="label-text">Сумма ставки (10 - 50000)</label>
                <input
                  type="number"
                  value={betAmount}
                  onChange={(e) => setBetAmount(Math.min(50000, Math.max(10, parseInt(e.target.value) || 10)))}
                  className="input-field text-center font-orbitron text-xl"
                  min="10"
                  max="50000"
                  disabled={playing}
                  data-testid="bet-input"
                />
              </div>

              {/* Start Button */}
              <button
                onClick={startGame}
                disabled={playing || betAmount < 10 || betAmount > 50000 || (user?.coins || 0) < betAmount}
                className="btn-primary w-full py-4 text-lg"
                data-testid="start-crash-game"
              >
                {playing ? "..." : `ИГРАТЬ (${betAmount} монет)`}
              </button>

              {/* User Balance */}
              <div className="text-gray-400 text-sm">
                Ваш баланс: <span className="text-yellow-400 font-bold">{user?.coins || 0}</span> монет
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Game Info */}
      <div className="grid md:grid-cols-2 gap-4 max-w-2xl mx-auto">
        <div className="card p-4">
          <h3 className="font-orbitron text-sm font-bold text-white mb-3 flex items-center gap-2">
            <Coins size={16} /> СТАВКИ
          </h3>
          <div className="text-gray-400 text-sm space-y-1">
            <div>Минимум: 10 монет</div>
            <div>Максимум: 50,000 монет</div>
            <div>При 1.0x: возврат ставки</div>
          </div>
        </div>
        <div className="card p-4">
          <h3 className="font-orbitron text-sm font-bold text-white mb-3 flex items-center gap-2">
            <TrendingUp size={16} /> МНОЖИТЕЛИ
          </h3>
          <div className="text-gray-400 text-sm space-y-1">
            <div>Минимум: 0.2x</div>
            <div>Максимум: 30x</div>
            <div>Случайное распределение</div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ==================== GAMES HUB ====================
const GamesHub = () => {
  const [activeGame, setActiveGame] = useState(null); // null, 'dodge', 'crash'

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

              {/* Crash Game Card */}
              <div 
                className="card cursor-pointer hover:border-white/40 transition-all active:scale-95 md:hover:scale-105 p-4 md:p-8"
                onClick={() => setActiveGame('crash')}
                data-testid="select-crash"
              >
                <div className="w-16 h-16 md:w-20 md:h-20 mx-auto flex items-center justify-center bg-green-500/20 border border-green-500/30 rounded-lg mb-4 md:mb-6">
                  <TrendingUp size={32} className="text-green-400" />
                </div>
                <h2 className="font-orbitron text-lg md:text-xl text-center mb-2 md:mb-3">CRASH</h2>
                <p className="text-gray-400 text-center text-sm md:text-base mb-3 md:mb-4">Угадай множитель!</p>
                <div className="text-center">
                  <span className="inline-block px-3 py-1.5 md:px-4 md:py-2 bg-green-500/20 border border-green-500/30 text-green-400 text-xs md:text-sm">
                    До 30x множитель
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

        {activeGame === 'crash' && (
          <div className="pt-8 md:pt-4">
            <button 
              onClick={() => setActiveGame(null)} 
              className="mb-4 md:mb-6 flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm md:text-base"
            >
              <ChevronRight size={16} className="rotate-180" /> Назад к играм
            </button>
            <CrashGameInner />
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
    { key: "custom_role", icon: Award, name: "Кастомная роль", desc: "Создай свою уникальную роль", price: 20000, needsName: true },
    { key: "custom_gradient", icon: Palette, name: "Градиент роли", desc: "Добавь градиент к своей роли", price: 25000, needsName: true },
    { key: "create_clan", icon: Users, name: "Создание клана", desc: "Основай свой собственный клан", price: 70000, needsName: true, disabled: !!user?.clan },
    { key: "clan_category", icon: FolderTree, name: "Категория клана", desc: "Добавь категорию для клана", price: 80000, needsName: false, disabled: !user?.clan || user?.clanCategory },
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
      // Get max length based on item type
      let maxLength = 20;
      if (itemType === "create_clan" || itemType === "clan_category") {
        maxLength = 10;
      }
      
      itemName = prompt(`Введите название для "${label}" (макс ${maxLength} символов):`);
      if (!itemName) return;
      
      // Validate length on frontend
      if (itemName.length > maxLength) {
        toast.error(`Название не более ${maxLength} символов`);
        return;
      }
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

        {/* Level requirement warning */}
        {user && !user.isAdmin && user.username.toLowerCase() !== 'pseudotamine' && (user.level || 1) < 10 && (
          <div className="card mb-6 bg-yellow-500/10 border-yellow-500/30">
            <div className="flex items-start gap-3">
              <div className="text-yellow-400 text-2xl">⚠️</div>
              <div>
                <h3 className="text-yellow-400 font-bold mb-1">Переводы недоступны</h3>
                <p className="text-gray-400 text-sm">
                  Для разблокировки переводов нужен <span className="text-white font-bold">10 уровень</span>.
                  Ваш текущий уровень: <span className="text-yellow-400">{user.level || 1}</span>
                </p>
              </div>
            </div>
          </div>
        )}

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
  const [pendingUsers, setPendingUsers] = useState([]);
  const [pendingWins, setPendingWins] = useState([]);
  const [targetUsername, setTargetUsername] = useState("");
  const [coinsAmount, setCoinsAmount] = useState("");
  const [deleteUsername, setDeleteUsername] = useState("");
  const [levelTarget, setLevelTarget] = useState("");
  const [levelAmount, setLevelAmount] = useState("");
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

  const loadPendingUsers = async () => {
    try {
      const res = await axios.get(`${API}/admin/pending-users`, { headers: { Authorization: `Bearer ${token}` } });
      setPendingUsers(res.data);
    } catch (error) {
      toast.error("Ошибка загрузки ожидающих");
    }
  };

  const loadPendingWins = async () => {
    try {
      const res = await axios.get(`${API}/admin/pending-wins`, { headers: { Authorization: `Bearer ${token}` } });
      setPendingWins(res.data);
    } catch (error) {
      toast.error("Ошибка загрузки выигрышей");
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
    loadPendingUsers();
    loadPendingWins();
    checkIsCreator();
  }, []);

  const handleAddCoins = async (e) => {
    e.preventDefault();
    if (!targetUsername.trim()) { toast.error("Введите имя"); return; }
    const amount = parseInt(coinsAmount);
    if (!amount || amount <= 0) { toast.error("Введите сумму"); return; }

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

  const handleRemoveCoins = async (e) => {
    e.preventDefault();
    if (!targetUsername.trim()) { toast.error("Введите имя"); return; }
    const amount = parseInt(coinsAmount);
    if (!amount || amount <= 0) { toast.error("Введите сумму"); return; }
    // No limit on removing coins for admins

    if (!window.confirm(`Снять ${amount} монет у ${targetUsername.trim()}?`)) return;

    setLoading(true);
    try {
      const res = await axios.post(`${API}/admin/remove-coins`, { targetUsername: targetUsername.trim(), amount }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(`-${res.data.removedCoins} монет у ${res.data.fromUser}`);
      setTargetUsername("");
      setCoinsAmount("");
      loadUsers();
      if (targetUsername.trim().toLowerCase() === user?.username.toLowerCase()) await refreshUser();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка");
    } finally { setLoading(false); }
  };

  const handleDeleteUser = async (e) => {
    e.preventDefault();
    if (!deleteUsername.trim()) { toast.error("Введите имя пользователя для удаления"); return; }

    const confirmation = window.prompt(
      `⚠️ ВНИМАНИЕ! Вы собираетесь ПОЛНОСТЬЮ удалить пользователя "${deleteUsername.trim()}" из базы данных.\n\nЭто действие НЕОБРАТИМО!\n\nВведите "УДАЛИТЬ" для подтверждения:`
    );

    if (confirmation !== "УДАЛИТЬ") {
      toast.info("Удаление отменено");
      return;
    }

    setLoading(true);
    try {
      const res = await axios.post(`${API}/admin/delete-user`, { targetUsername: deleteUsername.trim() }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(res.data.message);
      setDeleteUsername("");
      loadUsers();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка при удалении");
    } finally { setLoading(false); }
  };

  const handleSetLevel = async (e) => {
    e.preventDefault();
    if (!levelTarget.trim()) { toast.error("Введите имя пользователя"); return; }
    const level = parseInt(levelAmount);
    if (!level || level < 1 || level > 100) { toast.error("Уровень от 1 до 100"); return; }

    if (!window.confirm(`Выдать ${level} уровень пользователю ${levelTarget.trim()}?`)) return;

    setLoading(true);
    try {
      const res = await axios.post(`${API}/admin/set-level`, { targetUsername: levelTarget.trim(), level }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(res.data.message);
      setLevelTarget("");
      setLevelAmount("");
      loadUsers();
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

  const handleApproveUser = async (username) => {
    try {
      const res = await axios.post(`${API}/admin/approve-user`, { targetUsername: username }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(res.data.message);
      loadPendingUsers();
      loadUsers();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка");
    }
  };

  const handleDeletePending = async (username) => {
    if (!window.confirm(`Удалить аккаунт ${username}?`)) return;
    try {
      const res = await axios.delete(`${API}/admin/delete-pending`, { 
        data: { targetUsername: username },
        headers: { Authorization: `Bearer ${token}` } 
      });
      toast.success(res.data.message);
      loadPendingUsers();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка");
    }
  };

  const handleApproveWin = async (winId) => {
    try {
      const res = await axios.post(`${API}/admin/approve-win`, { winId }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(res.data.message);
      loadPendingWins();
      loadUsers();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ошибка");
    }
  };

  const handleRejectWin = async (winId) => {
    if (!window.confirm('Отклонить этот выигрыш?')) return;
    try {
      const res = await axios.post(`${API}/admin/reject-win`, { winId }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(res.data.message);
      loadPendingWins();
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
          {/* Add/Remove Coins */}
          <div className="card">
            <h2 className="font-orbitron text-lg mb-6 flex items-center gap-2">
              <Coins size={18} /> УПРАВЛЕНИЕ МОНЕТАМИ
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
              <div className="grid grid-cols-2 gap-3">
                <button type="submit" disabled={loading} className="btn-primary flex items-center justify-center gap-2" data-testid="admin-add-coins-btn">
                  <Plus size={16} /> {loading ? "..." : "ДОБАВИТЬ"}
                </button>
                <button type="button" onClick={handleRemoveCoins} disabled={loading} className="btn-secondary flex items-center justify-center gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10" data-testid="admin-remove-coins-btn">
                  <Send size={16} className="rotate-180" /> {loading ? "..." : "СНЯТЬ"}
                </button>
              </div>
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

        {/* Delete User Block */}
        <div className="card mb-8">
          <h2 className="font-orbitron text-lg mb-6 flex items-center gap-2 text-red-400">
            <Trash2 size={18} /> УДАЛЕНИЕ ПОЛЬЗОВАТЕЛЯ
          </h2>
          <div className="bg-red-500/10 border border-red-500/30 p-4 mb-4 text-sm">
            <p className="text-red-400 font-bold mb-2">⚠️ ВНИМАНИЕ!</p>
            <ul className="text-gray-400 space-y-1 list-disc list-inside">
              <li>Пользователь будет ПОЛНОСТЬЮ удален из базы данных</li>
              <li>Невозможно удалить создателя (pseudotamine) и админов</li>
              <li>После удаления можно зарегистрироваться под этим ником</li>
              <li>Действие НЕОБРАТИМО - восстановление невозможно</li>
            </ul>
          </div>
          <form onSubmit={handleDeleteUser} className="space-y-4">
            <div>
              <label className="label-text">Имя пользователя для удаления</label>
              <input 
                type="text" 
                value={deleteUsername} 
                onChange={(e) => setDeleteUsername(e.target.value)} 
                className="input-field" 
                placeholder="Введите имя пользователя" 
                data-testid="admin-delete-username" 
              />
            </div>
            <button 
              type="submit" 
              disabled={loading || !deleteUsername.trim()} 
              className="btn-secondary w-full flex items-center justify-center gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10" 
              data-testid="admin-delete-user-btn"
            >
              <Trash2 size={16} /> {loading ? "..." : "УДАЛИТЬ ПОЛЬЗОВАТЕЛЯ"}
            </button>
          </form>
          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-gray-500 text-sm">
              <span className="text-yellow-400">💡 Защита от мультиаккаунтов:</span>
              <br />Максимум 3 регистрации с одного IP за 24 часа. Cooldown: 10 минут между регистрациями.
            </p>
          </div>
        </div>

        {/* Set Level Block */}
        <div className="card mb-8">
          <h2 className="font-orbitron text-lg mb-6 flex items-center gap-2 text-purple-400">
            <TrendingUp size={18} /> ВЫДАЧА УРОВНЯ
          </h2>
          <div className="bg-purple-500/10 border border-purple-500/30 p-4 mb-4 text-sm">
            <p className="text-purple-400 font-bold mb-2">ℹ️ Информация</p>
            <ul className="text-gray-400 space-y-1 list-disc list-inside">
              <li>Установить уровень от 1 до 100 любому пользователю</li>
              <li>XP автоматически синхронизируется с новым уровнем</li>
              <li>Требование для следующего уровня рассчитывается автоматически</li>
              <li>Переводы доступны с 10 уровня (кроме админов)</li>
            </ul>
          </div>
          <form onSubmit={handleSetLevel} className="space-y-4">
            <div>
              <label className="label-text">Имя пользователя</label>
              <input 
                type="text" 
                value={levelTarget} 
                onChange={(e) => setLevelTarget(e.target.value)} 
                className="input-field" 
                placeholder="Введите имя пользователя" 
                data-testid="admin-level-username" 
              />
            </div>
            <div>
              <label className="label-text">Уровень (1-100)</label>
              <input 
                type="number" 
                value={levelAmount} 
                onChange={(e) => setLevelAmount(e.target.value)} 
                className="input-field" 
                placeholder="30" 
                min="1" 
                max="100"
                data-testid="admin-level-amount" 
              />
            </div>
            <button 
              type="submit" 
              disabled={loading || !levelTarget.trim() || !levelAmount} 
              className="btn-secondary w-full flex items-center justify-center gap-2 border-purple-500/30 text-purple-400 hover:bg-purple-500/10" 
              data-testid="admin-set-level-btn"
            >
              <TrendingUp size={16} /> {loading ? "..." : "ВЫДАТЬ УРОВЕНЬ"}
            </button>
          </form>
        </div>

        {/* Pending Wins Approval Section */}
        <div className="card mb-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="font-orbitron text-lg flex items-center gap-2">
              <Trophy size={18} /> ОДОБРЕНИЕ ВЫИГРЫШЕЙ
            </h2>
            <button onClick={loadPendingWins} className="btn-secondary flex items-center gap-2">
              <RefreshCw size={14} /> ОБНОВИТЬ
            </button>
          </div>
          <p className="text-gray-500 text-sm mb-4">Крупные выигрыши требующие одобрения (Crash >5000, Dodge >200)</p>
          
          {pendingWins.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              Нет выигрышей, ожидающих одобрения
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Игрок</th>
                    <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Игра</th>
                    <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Монеты</th>
                    <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">XP</th>
                    <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Время</th>
                    <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingWins.map((w, i) => (
                    <tr key={w.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-4 px-4 font-medium">{w.username}</td>
                      <td className="py-4 px-4">
                        <span className={`px-3 py-1 rounded text-xs font-bold ${w.gameType === 'dodge' ? 'bg-blue-500/20 text-blue-400' : 'bg-orange-500/20 text-orange-400'}`}>
                          {w.gameType === 'dodge' ? 'Dodge Arena' : 'Crash'}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-yellow-400 font-bold">+{w.coinsEarned}</span>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-purple-400 font-bold">+{w.xpEarned}</span>
                      </td>
                      <td className="py-4 px-4 text-gray-400 text-sm">
                        {new Date(w.createdAt).toLocaleDateString('ru-RU', { 
                          day: '2-digit', 
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex gap-2">
                          <button 
                            onClick={() => handleApproveWin(w.id)} 
                            className="px-4 py-2 text-sm bg-green-500/20 border border-green-500/50 text-green-400 hover:bg-green-500/30 transition-colors flex items-center gap-2"
                          >
                            <Check size={16} /> Одобрить
                          </button>
                          <button 
                            onClick={() => handleRejectWin(w.id)} 
                            className="px-4 py-2 text-sm bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30 transition-colors flex items-center gap-2"
                          >
                            <X size={16} /> Отклонить
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pending Users Approval Section */}
        <div className="card mb-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="font-orbitron text-lg flex items-center gap-2">
              <UserCheck size={18} /> РАЗРЕШЕНИЕ ДЛЯ ВХОДА
            </h2>
            <button onClick={loadPendingUsers} className="btn-secondary flex items-center gap-2">
              <RefreshCw size={14} /> ОБНОВИТЬ
            </button>
          </div>
          <p className="text-gray-500 text-sm mb-4">Пользователи, ожидающие одобрения для входа на платформу</p>
          
          {pendingUsers.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              Нет пользователей, ожидающих одобрения
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Имя</th>
                    <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">IP Адрес</th>
                    <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Дата регистрации</th>
                    <th className="text-left py-4 px-4 font-orbitron text-xs text-gray-400 uppercase tracking-wider">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingUsers.map((u, i) => (
                    <tr key={u.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-4 px-4 font-medium">{u.username}</td>
                      <td className="py-4 px-4 text-gray-400 font-mono text-sm">{u.registrationIP || "N/A"}</td>
                      <td className="py-4 px-4 text-gray-400 text-sm">
                        {new Date(u.createdAt).toLocaleDateString('ru-RU', { 
                          day: '2-digit', 
                          month: '2-digit', 
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex gap-2">
                          <button 
                            onClick={() => handleApproveUser(u.username)} 
                            className="px-4 py-2 text-sm bg-green-500/20 border border-green-500/50 text-green-400 hover:bg-green-500/30 transition-colors flex items-center gap-2"
                          >
                            <Check size={16} /> Впустить
                          </button>
                          <button 
                            onClick={() => handleDeletePending(u.username)} 
                            className="px-4 py-2 text-sm bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30 transition-colors flex items-center gap-2"
                          >
                            <X size={16} /> Удалить аккаунт
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Users Table */}
        <div className="card">
          <div className="flex justify-between items-center mb-6">
            <h2 className="font-orbitron text-lg flex items-center gap-2">
              <Users size={18} /> ВСЕ ПОЛЬЗОВАТЕЛИ ОНЛАЙН
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
