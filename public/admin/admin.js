(async function initAdminPage(global) {
    const registry = global.VendoModules;
    const moduleMap = new Map((registry?.all || []).map((module) => [module.id, module]));

    const state = {
        users: [],
        meta: null,
        search: "",
        activeUserId: null,
        modalMode: null,
    };

    const elements = {
        authUsersPath: document.getElementById("admin-auth-users-path"),
        stats: document.getElementById("admin-stats"),
        message: document.getElementById("admin-message"),
        search: document.getElementById("admin-user-search"),
        createOpen: document.getElementById("admin-create-open"),
        usersBody: document.getElementById("admin-users-body"),
        roleCards: document.getElementById("admin-role-cards"),
        modal: document.getElementById("admin-modal"),
        modalTitle: document.getElementById("admin-modal-title"),
        modalCopy: document.getElementById("admin-modal-copy"),
        modalMessage: document.getElementById("admin-modal-message"),
        userForm: document.getElementById("admin-user-form"),
        userLogin: document.getElementById("admin-user-login"),
        userDisplayName: document.getElementById("admin-user-display-name"),
        userPasswordField: document.getElementById("admin-user-password-field"),
        userPassword: document.getElementById("admin-user-password"),
        userActive: document.getElementById("admin-user-active"),
        userRoles: document.getElementById("admin-user-roles"),
        userModules: document.getElementById("admin-user-modules"),
        userSubmit: document.getElementById("admin-user-submit"),
        resetSection: document.getElementById("admin-reset-section"),
        resetForm: document.getElementById("admin-reset-password-form"),
        resetPassword: document.getElementById("admin-reset-password"),
        resetSubmit: document.getElementById("admin-reset-password-submit"),
        modalCloseButtons: document.querySelectorAll("[data-admin-modal-close]"),
    };

    if (!elements.stats || !elements.usersBody || !elements.userForm || !elements.resetForm || !elements.modal) {
        return;
    }

    elements.search?.addEventListener("input", () => {
        state.search = String(elements.search.value || "").trim();
        renderUsersTable();
    });

    elements.createOpen?.addEventListener("click", () => {
        openCreateModal();
    });

    elements.usersBody.addEventListener("click", (event) => {
        const editButton = event.target.closest("[data-user-edit]");
        if (editButton) {
            event.stopPropagation();
            openEditModal(editButton.getAttribute("data-user-edit"));
            return;
        }

        const row = event.target.closest("[data-user-open]");
        if (!row) {
            return;
        }

        openEditModal(row.getAttribute("data-user-open"));
    });

    elements.usersBody.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }

        const row = event.target.closest("[data-user-open]");
        if (!row) {
            return;
        }

        event.preventDefault();
        openEditModal(row.getAttribute("data-user-open"));
    });

    for (const button of elements.modalCloseButtons) {
        button.addEventListener("click", () => {
            closeModal();
        });
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && isModalOpen()) {
            closeModal();
        }
    });

    elements.userForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideModalMessage();

        const payload = {
            login: readTrimmed(elements.userForm, "login"),
            displayName: readTrimmed(elements.userForm, "displayName"),
            isActive: readCheckbox(elements.userForm, "isActive"),
            roles: getCheckedValues(elements.userRoles),
            modules: getCheckedValues(elements.userModules),
        };

        const isCreateMode = state.modalMode === "create";
        if (isCreateMode) {
            payload.password = readField(elements.userForm, "password");
        }

        setButtonBusy(elements.userSubmit, true, isCreateMode ? "Tworzenie..." : "Zapisywanie...");

        try {
            const data = await requestJson(
                isCreateMode ? "/api/admin/users" : `/api/admin/users/${encodeURIComponent(state.activeUserId || "")}`,
                {
                    method: isCreateMode ? "POST" : "PATCH",
                    body: JSON.stringify(payload),
                }
            );

            applyUsersPayload(data, data.user?.id || state.activeUserId);
            renderPage();
            closeModal();
            showMessage(
                isCreateMode
                    ? `Dodano konto ${data.user?.login || payload.login}.`
                    : `Zapisano zmiany dla ${data.user?.login || payload.login}.`,
                "success"
            );
        } catch (error) {
            showModalMessage(error.message || "Nie udalo sie zapisac formularza.", "error");
        } finally {
            setButtonBusy(elements.userSubmit, false, isCreateMode ? "Utworz konto" : "Zapisz zmiany");
        }
    });

    elements.resetForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideModalMessage();

        const activeUser = getActiveUser();
        if (!activeUser) {
            showModalMessage("Nie wybrano konta do zmiany hasla.", "error");
            return;
        }

        setButtonBusy(elements.resetSubmit, true, "Zmiana...");

        try {
            const data = await requestJson(`/api/admin/users/${encodeURIComponent(activeUser.id)}/reset-password`, {
                method: "POST",
                body: JSON.stringify({
                    password: readField(elements.resetForm, "password"),
                }),
            });

            mergeUser(data.user);
            renderUsersTable();
            elements.resetForm.reset();
            showModalMessage(data.message || `Haslo dla ${activeUser.login} zostalo zmienione.`, "success");
        } catch (error) {
            showModalMessage(error.message || "Nie udalo sie zmienic hasla.", "error");
        } finally {
            setButtonBusy(elements.resetSubmit, false, "Zmien haslo");
        }
    });

    await loadUsers();

    async function loadUsers(preferredUserId = null) {
        try {
            const data = await requestJson("/api/admin/users");
            applyUsersPayload(data, preferredUserId);
            renderPage();
        } catch (error) {
            showMessage(error.message || "Nie udalo sie odczytac listy uzytkownikow.", "error");
        }
    }

    function applyUsersPayload(payload, preferredUserId) {
        state.users = Array.isArray(payload?.users) ? payload.users.slice() : [];
        state.meta = payload?.meta || state.meta;

        const availableIds = new Set(state.users.map((user) => user.id));
        if (preferredUserId && availableIds.has(preferredUserId)) {
            state.activeUserId = preferredUserId;
            return;
        }

        if (state.activeUserId && availableIds.has(state.activeUserId)) {
            return;
        }

        state.activeUserId = state.users[0]?.id || null;
    }

    function mergeUser(user) {
        if (!user?.id) {
            return;
        }

        const index = state.users.findIndex((candidate) => candidate.id === user.id);
        if (index >= 0) {
            state.users[index] = {
                ...state.users[index],
                ...user,
            };
        } else {
            state.users.push(user);
        }
    }

    function renderPage() {
        if (elements.authUsersPath && state.meta?.authUsersPath) {
            elements.authUsersPath.textContent = state.meta.authUsersPath;
        }

        renderStats();
        renderUsersTable();
        renderRoleCards();
    }

    function renderStats() {
        const total = state.users.length;
        const active = state.users.filter((user) => user.isActive !== false).length;
        const admins = state.users.filter((user) => Array.isArray(user.roles) && user.roles.includes("admin")).length;
        const manualModules = state.users.filter((user) => Array.isArray(user.modules) && user.modules.length > 0).length;

        elements.stats.innerHTML = [
            statCard("Konta", total, "Liczba wszystkich lokalnych kont aplikacji."),
            statCard("Aktywne", active, "Konta, ktore moga zalogowac sie od razu."),
            statCard("Admini", admins, "Role z pelnym dostepem do administracji i modulow."),
            statCard("Wyjatki", manualModules, "Konta z dodatkowymi modulami poza standardowa rola."),
        ].join("");
    }

    function renderUsersTable() {
        const filteredUsers = getFilteredUsers();

        if (!filteredUsers.length) {
            elements.usersBody.innerHTML = `
                <tr>
                    <td colspan="7" class="admin-empty-state">Brak kont pasujacych do obecnego filtra.</td>
                </tr>
            `;
            return;
        }

        elements.usersBody.innerHTML = filteredUsers.map((user) => {
            const isActiveRow = user.id === state.activeUserId;

            return `
                <tr
                    class="${isActiveRow ? "is-selected" : ""}"
                    data-user-open="${escapeHtml(user.id)}"
                    tabindex="0"
                    aria-selected="${isActiveRow ? "true" : "false"}"
                >
                    <td>
                        <span class="admin-user-link">${escapeHtml(user.login)}</span>
                        <span class="admin-user-subtle">Kliknij wiersz lub przycisk Edytuj</span>
                    </td>
                    <td>
                        <span class="admin-user-name">${escapeHtml(user.displayName || user.login)}</span>
                        <span class="admin-user-subtle">${escapeHtml(user.id)}</span>
                    </td>
                    <td>${renderChipList(user.roles || [], "role")}</td>
                    <td>${renderChipList(user.modules || [], "module", "Brak wyjatkow")}</td>
                    <td>${renderStatusPill(user.isActive !== false)}</td>
                    <td>
                        <span class="admin-user-name">${escapeHtml(formatDateTime(user.updatedAt))}</span>
                        <span class="admin-user-subtle">utworzono: ${escapeHtml(formatDateTime(user.createdAt))}</span>
                    </td>
                    <td class="admin-actions-cell">
                        <button type="button" class="admin-row-action" data-user-edit="${escapeHtml(user.id)}">Edytuj</button>
                    </td>
                </tr>
            `;
        }).join("");
    }

    function renderRoleCards() {
        const roleOptions = getRoleOptions();

        if (!roleOptions.length) {
            elements.roleCards.innerHTML = `<div class="admin-empty-state">Brak zdefiniowanych rol.</div>`;
            return;
        }

        elements.roleCards.innerHTML = roleOptions.map((role) => `
            <article class="admin-role-card">
                <div class="admin-role-card__heading">
                    <strong>${escapeHtml(role.label)}</strong>
                    <span>${escapeHtml(role.description)}</span>
                </div>
                <div class="admin-chip-list">
                    ${role.moduleIds.length
            ? role.moduleIds.map((moduleId) => `<span class="admin-chip is-module">${escapeHtml(getModuleLabel(moduleId))}</span>`).join("")
            : `<span class="admin-chip is-muted">Pelny dostep</span>`}
                </div>
            </article>
        `).join("");
    }

    function openCreateModal() {
        state.modalMode = "create";
        hideMessage();
        renderModal();
        setModalVisible(true);
        elements.userLogin?.focus();
    }

    function openEditModal(userId) {
        const user = state.users.find((candidate) => candidate.id === String(userId || "").trim());
        if (!user) {
            showMessage("Nie znaleziono wybranego konta.", "error");
            return;
        }

        state.activeUserId = user.id;
        state.modalMode = "edit";
        hideMessage();
        renderUsersTable();
        renderModal();
        setModalVisible(true);
        elements.userLogin?.focus();
    }

    function closeModal() {
        state.modalMode = null;
        clearModalState();
        setModalVisible(false);
    }

    function renderModal() {
        const isCreateMode = state.modalMode === "create";
        const user = isCreateMode ? null : getActiveUser();
        if (!isCreateMode && !user) {
            return;
        }

        hideModalMessage();
        elements.userForm.reset();
        elements.resetForm.reset();

        if (isCreateMode) {
            elements.modalTitle.textContent = "Dodaj uzytkownika";
            elements.modalCopy.textContent = "Utworz lokalne konto aplikacji i ustaw jego role oraz dodatkowe moduly.";
            elements.userSubmit.textContent = "Utworz konto";
            elements.userSubmit.dataset.defaultLabel = "Utworz konto";
            elements.userPasswordField.classList.remove("hidden");
            elements.userPassword.disabled = false;
            elements.userPassword.required = true;
            elements.userActive.checked = true;
            renderOptionGroup(elements.userRoles, getRoleOptions(), [], "admin-user-role");
            renderOptionGroup(elements.userModules, getModuleOptions(), [], "admin-user-module");
            elements.resetSection.classList.add("hidden");
            return;
        }

        elements.modalTitle.textContent = `Edytuj ${user.login}`;
        elements.modalCopy.textContent = "Zmien dane konta, role i dodatkowe moduly. Reset hasla jest dostepny nizej.";
        elements.userSubmit.textContent = "Zapisz zmiany";
        elements.userSubmit.dataset.defaultLabel = "Zapisz zmiany";
        elements.userLogin.value = user.login || "";
        elements.userDisplayName.value = user.displayName || "";
        elements.userActive.checked = user.isActive !== false;
        elements.userPasswordField.classList.add("hidden");
        elements.userPassword.disabled = true;
        elements.userPassword.required = false;
        elements.userPassword.value = "";
        renderOptionGroup(elements.userRoles, getRoleOptions(), user.roles || [], "admin-user-role");
        renderOptionGroup(elements.userModules, getModuleOptions(), user.modules || [], "admin-user-module");
        elements.resetSection.classList.remove("hidden");
    }

    function clearModalState() {
        hideModalMessage();
        elements.userForm.reset();
        elements.resetForm.reset();
        elements.userPassword.disabled = false;
        elements.userPassword.required = true;
        elements.userPasswordField.classList.remove("hidden");
        elements.resetSection.classList.add("hidden");
    }

    function setModalVisible(visible) {
        elements.modal.classList.toggle("hidden", !visible);
        document.body.classList.toggle("admin-modal-open", visible);
    }

    function isModalOpen() {
        return state.modalMode === "create" || state.modalMode === "edit";
    }

    function getActiveUser() {
        return state.users.find((user) => user.id === state.activeUserId) || null;
    }

    function getRoleOptions() {
        const roles = Array.isArray(state.meta?.roles) ? state.meta.roles : [];
        return roles.map((roleId) => {
            if (roleId === "admin") {
                return {
                    id: roleId,
                    label: "Admin",
                    description: "Pelny dostep do panelu administracyjnego oraz wszystkich modulow aplikacji.",
                    moduleIds: [],
                };
            }

            const moduleIds = Array.isArray(state.meta?.roleModules?.[roleId]) ? state.meta.roleModules[roleId] : [];
            return {
                id: roleId,
                label: getRoleLabel(roleId),
                description: moduleIds.length
                    ? `Pakiet modulow: ${moduleIds.map((moduleId) => getModuleLabel(moduleId)).join(", ")}.`
                    : "Rola bez domyslnych modulow.",
                moduleIds,
            };
        });
    }

    function getModuleOptions() {
        const moduleIds = Array.isArray(state.meta?.assignableModules)
            ? state.meta.assignableModules
            : Array.isArray(state.meta?.modules)
                ? state.meta.modules.filter((moduleId) => moduleId !== "start" && moduleId !== "admin")
                : [];

        return moduleIds.map((moduleId) => {
            const moduleDefinition = moduleMap.get(moduleId);
            return {
                id: moduleId,
                label: moduleDefinition?.label || moduleId,
                description: moduleDefinition?.description || `Dostep do modulu ${moduleId}.`,
            };
        });
    }

    function getFilteredUsers() {
        const query = state.search.trim().toLowerCase();
        if (!query) {
            return state.users.slice();
        }

        return state.users.filter((user) => {
            const searchable = [
                user.login,
                user.displayName,
                ...(Array.isArray(user.roles) ? user.roles.map((role) => getRoleLabel(role)) : []),
                ...(Array.isArray(user.modules) ? user.modules.map((moduleId) => getModuleLabel(moduleId)) : []),
            ].join(" ").toLowerCase();

            return searchable.includes(query);
        });
    }

    function renderOptionGroup(container, options, selectedValues, inputPrefix) {
        if (!container) {
            return;
        }

        const selectedSet = new Set(Array.isArray(selectedValues) ? selectedValues : []);
        container.innerHTML = options.map((option, index) => `
            <label class="admin-option-card${selectedSet.has(option.id) ? " is-checked" : ""}">
                <input
                    type="checkbox"
                    value="${escapeHtml(option.id)}"
                    id="${escapeHtml(`${inputPrefix}-${index}`)}"
                    ${selectedSet.has(option.id) ? "checked" : ""}
                >
                <span class="admin-option-card__copy">
                    <strong>${escapeHtml(option.label)}</strong>
                    <small>${escapeHtml(option.description)}</small>
                </span>
            </label>
        `).join("");

        for (const input of container.querySelectorAll('input[type="checkbox"]')) {
            input.addEventListener("change", () => {
                const card = input.closest(".admin-option-card");
                if (card) {
                    card.classList.toggle("is-checked", input.checked);
                }
            });
        }
    }

    function renderChipList(values, type, emptyLabel = "Brak") {
        const list = Array.isArray(values) ? values : [];
        if (!list.length) {
            return `<div class="admin-chip-list"><span class="admin-chip is-muted">${escapeHtml(emptyLabel)}</span></div>`;
        }

        return `
            <div class="admin-chip-list">
                ${list.map((value) => {
            const label = type === "module" ? getModuleLabel(value) : getRoleLabel(value);
            return `<span class="admin-chip ${type === "module" ? "is-module" : "is-role"}">${escapeHtml(label)}</span>`;
        }).join("")}
            </div>
        `;
    }

    function renderStatusPill(isActive) {
        if (isActive) {
            return '<span class="admin-status-pill is-active">Aktywne</span>';
        }

        return '<span class="admin-status-pill is-inactive">Nieaktywne</span>';
    }

    function getCheckedValues(container) {
        return Array.from(container?.querySelectorAll('input[type="checkbox"]:checked') || [])
            .map((input) => String(input.value || "").trim())
            .filter(Boolean);
    }

    function readField(form, name) {
        const input = form?.elements?.namedItem(name);
        return input ? String(input.value || "") : "";
    }

    function readTrimmed(form, name) {
        return readField(form, name).trim();
    }

    function readCheckbox(form, name) {
        const input = form?.elements?.namedItem(name);
        return Boolean(input?.checked);
    }

    function setButtonBusy(button, isBusy, busyLabel) {
        if (!button) {
            return;
        }

        if (!button.dataset.defaultLabel) {
            button.dataset.defaultLabel = button.textContent || "";
        }

        button.disabled = isBusy;
        button.textContent = isBusy ? busyLabel : button.dataset.defaultLabel;
    }

    async function requestJson(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            headers: {
                Accept: "application/json",
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...(options.headers || {}),
            },
            ...options,
        });

        const raw = await response.text();
        const data = raw ? tryParseJson(raw) : {};

        if (response.status === 401) {
            const nextValue = `${window.location.pathname}${window.location.search}`;
            window.location.replace(`/login?next=${encodeURIComponent(nextValue)}`);
            throw new Error("Sesja wygasla. Zaloguj sie ponownie.");
        }

        if (!response.ok) {
            throw new Error(data?.error || "Nie udalo sie wykonac zadania.");
        }

        return data;
    }

    function tryParseJson(raw) {
        try {
            return JSON.parse(raw);
        } catch (_error) {
            return {};
        }
    }

    function showMessage(message, type) {
        if (!elements.message) {
            return;
        }

        elements.message.textContent = message;
        elements.message.classList.remove("hidden", "is-success", "is-error");
        elements.message.classList.add(type === "error" ? "is-error" : "is-success");
    }

    function hideMessage() {
        if (!elements.message) {
            return;
        }

        elements.message.textContent = "";
        elements.message.classList.add("hidden");
        elements.message.classList.remove("is-success", "is-error");
    }

    function showModalMessage(message, type) {
        if (!elements.modalMessage) {
            return;
        }

        elements.modalMessage.textContent = message;
        elements.modalMessage.classList.remove("hidden", "is-success", "is-error");
        elements.modalMessage.classList.add(type === "error" ? "is-error" : "is-success");
    }

    function hideModalMessage() {
        if (!elements.modalMessage) {
            return;
        }

        elements.modalMessage.textContent = "";
        elements.modalMessage.classList.add("hidden");
        elements.modalMessage.classList.remove("is-success", "is-error");
    }

    function statCard(label, value, hint) {
        return `
            <article class="admin-stat-card">
                <span class="admin-stat-card__label">${escapeHtml(label)}</span>
                <strong class="admin-stat-card__value">${escapeHtml(value)}</strong>
                <span class="admin-stat-card__hint">${escapeHtml(hint)}</span>
            </article>
        `;
    }

    function getRoleLabel(roleId) {
        const dictionary = {
            admin: "Admin",
            planner: "Planowanie",
            production: "Produkcja",
            operator: "Operator",
            analyst: "Analizy",
            integration: "Integracje",
        };

        return dictionary[roleId] || roleId;
    }

    function getModuleLabel(moduleId) {
        return moduleMap.get(moduleId)?.label || moduleId;
    }

    function formatDateTime(value) {
        if (!value) {
            return "Brak daty";
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        return new Intl.DateTimeFormat("pl-PL", {
            dateStyle: "short",
            timeStyle: "short",
        }).format(date);
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
})(window);
