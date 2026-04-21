const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, ".data");
const AUTH_USERS_PATH = path.join(DATA_DIR, "auth-users.json");
const STORE_VERSION = 1;

let cachedStore = null;

function getAuthUsersPath() {
    return AUTH_USERS_PATH;
}

function ensureDataDir() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
    return `scrypt:${salt}:${hash}`;
}

function verifyPassword(user, password) {
    const storedHash = String(user?.passwordHash || "");
    const [algorithm, salt, hash] = storedHash.split(":");

    if (algorithm !== "scrypt" || !salt || !hash) {
        return false;
    }

    const expected = Buffer.from(hash, "hex");
    const actual = crypto.scryptSync(String(password || ""), salt, expected.length);

    if (actual.length !== expected.length) {
        return false;
    }

    return crypto.timingSafeEqual(actual, expected);
}

function normalizeUser(rawUser = {}) {
    return {
        id: String(rawUser.id || crypto.randomUUID()),
        login: String(rawUser.login || "").trim(),
        displayName: String(rawUser.displayName || rawUser.login || "").trim(),
        passwordHash: String(rawUser.passwordHash || ""),
        roles: Array.isArray(rawUser.roles) ? rawUser.roles.map((role) => String(role || "").trim()).filter(Boolean) : [],
        modules: Array.isArray(rawUser.modules) ? rawUser.modules.map((moduleId) => String(moduleId || "").trim()).filter(Boolean) : [],
        isActive: rawUser.isActive !== false,
        createdAt: String(rawUser.createdAt || new Date().toISOString()),
        updatedAt: String(rawUser.updatedAt || rawUser.createdAt || new Date().toISOString()),
    };
}

function persistStore(store) {
    ensureDataDir();
    fs.writeFileSync(AUTH_USERS_PATH, JSON.stringify(store, null, 2), "utf8");
    cachedStore = store;
    return cachedStore;
}

function createBootstrapStore(options = {}) {
    const adminLogin = String(options.adminLogin || "admin").trim() || "admin";
    const adminPassword = String(options.adminPassword || "admin");
    const now = new Date().toISOString();
    const adminUser = normalizeUser({
        id: crypto.randomUUID(),
        login: adminLogin,
        displayName: "Administrator lokalny",
        passwordHash: hashPassword(adminPassword),
        roles: ["admin"],
        modules: [],
        isActive: true,
        createdAt: now,
        updatedAt: now,
    });

    const store = {
        version: STORE_VERSION,
        users: [adminUser],
    };

    persistStore(store);

    console.log(
        `Auth bootstrap: utworzono lokalne konto ${adminLogin} w ${AUTH_USERS_PATH}.`
    );

    return store;
}

function loadStore(options = {}) {
    if (cachedStore) {
        return cachedStore;
    }

    if (!fs.existsSync(AUTH_USERS_PATH)) {
        cachedStore = createBootstrapStore(options);
        return cachedStore;
    }

    const raw = fs.readFileSync(AUTH_USERS_PATH, "utf8");
    const normalizedRaw = String(raw || "").replace(/^\uFEFF/, "").trim();
    const parsed = normalizedRaw ? JSON.parse(normalizedRaw) : {};
    const users = Array.isArray(parsed.users) ? parsed.users.map(normalizeUser) : [];

    cachedStore = {
        version: Number(parsed.version) || STORE_VERSION,
        users,
    };

    return cachedStore;
}

function listUsers(options = {}) {
    const store = loadStore(options);
    return store.users
        .slice()
        .sort((left, right) => left.login.localeCompare(right.login, "pl-PL", { sensitivity: "base" }));
}

function countActiveAdmins(users) {
    return users.filter((user) => user.isActive !== false && Array.isArray(user.roles) && user.roles.includes("admin")).length;
}

function createUser(input, options = {}) {
    const store = loadStore(options);
    const login = String(input?.login || "").trim();
    const displayName = String(input?.displayName || login || "").trim();
    const password = String(input?.password || "");
    const roles = Array.isArray(input?.roles) ? input.roles.map((role) => String(role || "").trim()).filter(Boolean) : [];
    const modules = Array.isArray(input?.modules) ? input.modules.map((moduleId) => String(moduleId || "").trim()).filter(Boolean) : [];
    const isActive = input?.isActive !== false;

    if (!login) {
        throw new Error("Login jest wymagany.");
    }

    if (store.users.some((user) => user.login.toLowerCase() === login.toLowerCase())) {
        throw new Error("Uzytkownik o takim loginie juz istnieje.");
    }

    if (!password || password.length < 4) {
        throw new Error("Haslo musi miec co najmniej 4 znaki.");
    }

    const now = new Date().toISOString();
    const user = normalizeUser({
        id: crypto.randomUUID(),
        login,
        displayName,
        passwordHash: hashPassword(password),
        roles,
        modules,
        isActive,
        createdAt: now,
        updatedAt: now,
    });

    store.users.push(user);
    persistStore(store);
    return user;
}

function updateUser(userId, patch, options = {}) {
    const store = loadStore(options);
    const user = store.users.find((candidate) => candidate.id === String(userId || "").trim());

    if (!user) {
        throw new Error("Nie znaleziono uzytkownika.");
    }

    const nextLogin = patch?.login === undefined ? user.login : String(patch.login || "").trim();
    const nextDisplayName = patch?.displayName === undefined ? user.displayName : String(patch.displayName || nextLogin || "").trim();
    const nextRoles = patch?.roles === undefined
        ? [...user.roles]
        : (Array.isArray(patch.roles) ? patch.roles.map((role) => String(role || "").trim()).filter(Boolean) : []);
    const nextModules = patch?.modules === undefined
        ? [...user.modules]
        : (Array.isArray(patch.modules) ? patch.modules.map((moduleId) => String(moduleId || "").trim()).filter(Boolean) : []);
    const nextIsActive = patch?.isActive === undefined ? user.isActive !== false : patch.isActive !== false;

    if (!nextLogin) {
        throw new Error("Login jest wymagany.");
    }

    const duplicate = store.users.find((candidate) => candidate.id !== user.id && candidate.login.toLowerCase() === nextLogin.toLowerCase());
    if (duplicate) {
        throw new Error("Inny uzytkownik ma juz taki login.");
    }

    const previewUsers = store.users.map((candidate) => {
        if (candidate.id !== user.id) {
            return candidate;
        }

        return {
            ...candidate,
            roles: nextRoles,
            isActive: nextIsActive,
        };
    });

    if (countActiveAdmins(previewUsers) === 0) {
        throw new Error("Musi pozostac co najmniej jedno aktywne konto admina.");
    }

    user.login = nextLogin;
    user.displayName = nextDisplayName || nextLogin;
    user.roles = nextRoles;
    user.modules = nextModules;
    user.isActive = nextIsActive;
    user.updatedAt = new Date().toISOString();

    persistStore(store);
    return user;
}

function setUserPassword(userId, password, options = {}) {
    const store = loadStore(options);
    const user = store.users.find((candidate) => candidate.id === String(userId || "").trim());

    if (!user) {
        throw new Error("Nie znaleziono uzytkownika.");
    }

    const normalizedPassword = String(password || "");
    if (!normalizedPassword || normalizedPassword.length < 4) {
        throw new Error("Haslo musi miec co najmniej 4 znaki.");
    }

    user.passwordHash = hashPassword(normalizedPassword);
    user.updatedAt = new Date().toISOString();
    persistStore(store);
    return user;
}

function findUserByLogin(login, options = {}) {
    const normalizedLogin = String(login || "").trim().toLowerCase();
    if (!normalizedLogin) {
        return null;
    }

    const store = loadStore(options);
    return store.users.find((user) => user.login.toLowerCase() === normalizedLogin) || null;
}

function getUserById(userId, options = {}) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
        return null;
    }

    const store = loadStore(options);
    return store.users.find((user) => user.id === normalizedUserId) || null;
}

function getPublicUser(user) {
    if (!user) {
        return null;
    }

    return {
        id: user.id,
        login: user.login,
        displayName: user.displayName,
        roles: Array.isArray(user.roles) ? [...user.roles] : [],
        modules: Array.isArray(user.modules) ? [...user.modules] : [],
        isActive: user.isActive !== false,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
    };
}

module.exports = {
    createUser,
    findUserByLogin,
    getAuthUsersPath,
    getPublicUser,
    getUserById,
    hashPassword,
    listUsers,
    setUserPassword,
    updateUser,
    verifyPassword,
};
