(async function initVendoShell(global) {
    const registry = global.VendoModules;
    const main = document.querySelector(".app-shell, .mes-operator-shell");
    const SHELL_COLLAPSE_STORAGE_KEY = "vendo-shell-collapsed";

    if (!registry || !main) {
        return;
    }

    const moduleId = document.body.dataset.appModule || "";
    const pathname = window.location.pathname.endsWith("/") && window.location.pathname.length > 1
        ? window.location.pathname.slice(0, -1)
        : window.location.pathname;
    const moduleDefinition = registry.getModuleById(moduleId) || registry.getModuleByPath(pathname);

    if (!moduleDefinition) {
        return;
    }

    const requestedLayout = document.body.dataset.appLayout || moduleDefinition.layout || "standard";
    document.body.dataset.appLayout = requestedLayout;
    const shellCollapsed = loadShellCollapseState();
    document.body.classList.toggle("vendo-shell-collapsed", shellCollapsed);

    if (main.querySelector(".vendo-shell")) {
        return;
    }

    const authReady = loadAuthState();
    global.VendoAuth = {
        ready: authReady,
    };

    const authState = await authReady;
    if (!authState) {
        return;
    }

    global.VendoAuthState = authState;

    const allowedModuleIds = new Set(authState.allowedModuleIds || []);
    if (!allowedModuleIds.has(moduleDefinition.id)) {
        window.location.replace(authState.defaultPath || "/console");
        return;
    }

    const shell = requestedLayout === "operator"
        ? buildOperatorShell(moduleDefinition, authState)
        : buildPrimaryShell(
            moduleDefinition,
            registry.getNavigationModules().filter((module) => allowedModuleIds.has(module.id)),
            authState
        );

    main.prepend(shell);
    wireLogout(shell);
    wireShellToggle(shell);
    document.dispatchEvent(new CustomEvent("vendo-auth-ready", { detail: authState }));

    function buildPrimaryShell(activeModule, navigationModules, sessionState) {
        const shellElement = document.createElement("header");
        shellElement.className = `vendo-shell vendo-shell--${requestedLayout}`;

        const actions = [];
        actions.push(`<button type="button" class="vendo-shell__action-button vendo-shell__toggle-button" data-shell-toggle aria-pressed="${shellCollapsed ? "true" : "false"}">${shellCollapsed ? "Rozwin header" : "Zwin header"}</button>`);
        if (activeModule.id !== "start") {
            actions.push(`<a class="vendo-shell__action-link" href="/console">Panel startowy</a>`);
        }
        actions.push(`<span class="vendo-shell__action-badge">${escapeHtml(sessionState.user?.displayName || sessionState.user?.login || "Uzytkownik")}</span>`);
        actions.push(`<button type="button" class="vendo-shell__action-button" data-auth-logout>Wyloguj</button>`);

        shellElement.innerHTML = `
            <div class="vendo-shell__masthead">
                <div class="vendo-shell__brand-block">
                    <a class="vendo-shell__brand" href="/console" aria-label="Przejdz do panelu startowego MSX Workspace">
                        <img class="vendo-shell__brand-logo" src="/core/msx-logo.png" alt="MSX Elektronika">
                        <span class="vendo-shell__brand-copy">
                            <span class="vendo-shell__brand-title">MSX Workspace</span>
                            <span class="vendo-shell__brand-subtitle">Moduly robocze</span>
                        </span>
                    </a>
                    <div class="vendo-shell__context">
                        <span class="vendo-shell__eyebrow">${escapeHtml(activeModule.area || "Workspace")}</span>
                        <span class="vendo-shell__heading">${escapeHtml(activeModule.label)}</span>
                        ${activeModule.description ? `<span class="vendo-shell__description">${escapeHtml(activeModule.description || "")}</span>` : ""}
                    </div>
                </div>
                <div class="vendo-shell__actions">
                    ${actions.join("")}
                </div>
            </div>
            <nav class="vendo-shell__nav" aria-label="Globalna nawigacja modulow">
                ${navigationModules.map((module) => `
                    <a
                        class="vendo-shell__nav-item${module.id === activeModule.id ? " is-active" : ""}"
                        href="${module.path}"
                        ${module.id === activeModule.id ? 'aria-current="page"' : ""}
                    >
                        ${escapeHtml(module.navLabel || module.label)}
                    </a>
                `).join("")}
            </nav>
        `;

        return shellElement;
    }

    function buildOperatorShell(activeModule, sessionState) {
        const shellElement = document.createElement("header");
        shellElement.className = "vendo-shell vendo-shell--operator";

        const backPath = activeModule.compactBackPath || "/console";
        const backLabel = activeModule.compactBackLabel || "Panel startowy";

        shellElement.innerHTML = `
            <a class="vendo-shell__compact-link" href="${backPath}">
                ${escapeHtml(backLabel)}
            </a>
            <div class="vendo-shell__compact-context">
                <span>${escapeHtml(activeModule.area || "Produkcja")}</span>
                <strong>${escapeHtml(activeModule.label)}</strong>
            </div>
            <div class="vendo-shell__compact-actions">
                <span class="vendo-shell__action-badge">${escapeHtml(sessionState.user?.displayName || sessionState.user?.login || "Uzytkownik")}</span>
                <button type="button" class="vendo-shell__action-button" data-auth-logout>Wyloguj</button>
            </div>
        `;

        return shellElement;
    }

    async function loadAuthState() {
        try {
            const response = await fetch("/api/auth/me", {
                credentials: "same-origin",
                headers: {
                    Accept: "application/json",
                },
            });

            if (response.status === 401) {
                const nextValue = `${window.location.pathname}${window.location.search}`;
                window.location.replace(`/login?next=${encodeURIComponent(nextValue)}`);
                return null;
            }

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Nie udalo sie odczytac sesji.");
            }

            return data;
        } catch (_error) {
            const nextValue = `${window.location.pathname}${window.location.search}`;
            window.location.replace(`/login?next=${encodeURIComponent(nextValue)}`);
            return null;
        }
    }

    function wireLogout(root) {
        const logoutButtons = root.querySelectorAll("[data-auth-logout]");
        for (const button of logoutButtons) {
            button.addEventListener("click", async () => {
                button.disabled = true;

                try {
                    await fetch("/api/auth/logout", {
                        method: "POST",
                        credentials: "same-origin",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: "{}",
                    });
                } catch (_error) {
                    // Even if logout request fails, force redirect to login page.
                } finally {
                    window.location.replace("/login");
                }
            });
        }
    }

    function wireShellToggle(root) {
        const toggleButtons = root.querySelectorAll("[data-shell-toggle]");
        if (!toggleButtons.length) {
            return;
        }

        updateShellToggleButtons(toggleButtons, document.body.classList.contains("vendo-shell-collapsed"));

        for (const button of toggleButtons) {
            button.addEventListener("click", () => {
                const nextState = !document.body.classList.contains("vendo-shell-collapsed");
                document.body.classList.toggle("vendo-shell-collapsed", nextState);
                persistShellCollapseState(nextState);
                updateShellToggleButtons(toggleButtons, nextState);
            });
        }
    }

    function updateShellToggleButtons(buttons, collapsed) {
        for (const button of buttons) {
            button.textContent = collapsed ? "Rozwin header" : "Zwin header";
            button.setAttribute("aria-pressed", String(collapsed));
        }
    }

    function loadShellCollapseState() {
        try {
            return localStorage.getItem(SHELL_COLLAPSE_STORAGE_KEY) === "1";
        } catch (_error) {
            return false;
        }
    }

    function persistShellCollapseState(collapsed) {
        try {
            if (collapsed) {
                localStorage.setItem(SHELL_COLLAPSE_STORAGE_KEY, "1");
            } else {
                localStorage.removeItem(SHELL_COLLAPSE_STORAGE_KEY);
            }
        } catch (_error) {
            // Ignore localStorage failures and keep the current session state only.
        }
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
})(window);
