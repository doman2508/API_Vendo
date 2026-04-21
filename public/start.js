(async function initStartPage(global) {
    const container = document.getElementById("start-module-groups");
    const registry = global.VendoModules;

    if (!container || !registry) {
        return;
    }

    const authState = global.VendoAuth?.ready
        ? await global.VendoAuth.ready
        : global.VendoAuthState || { allowedModuleIds: registry.getStartModules().map((module) => module.id) };
    const allowedModuleIds = new Set(authState.allowedModuleIds || []);

    const areaCopy = {
        "Administracja": "Zarzadzanie kontami i dostepem do systemu.",
        "Zakupy i planowanie": "Planowanie materialowe i raporty zakupowe.",
        "Produkcja": "Dashboardy hali, diagnostyka i tryby stanowiskowe.",
        "Analizy": "Koszty i rentownosc do decyzji operacyjnych.",
        "Integracje": "Narzedzia pomocnicze i eksperymenty z endpointami.",
    };

    const groupedModules = registry.getStartModules().filter((module) => allowedModuleIds.has(module.id)).reduce((groups, module) => {
        const key = module.area || "Pozostale";
        if (!groups.has(key)) {
            groups.set(key, []);
        }

        groups.get(key).push(module);
        return groups;
    }, new Map());

    container.innerHTML = Array.from(groupedModules.entries()).map(([area, modules]) => `
        <section class="start-module-group">
            <div class="start-module-group-heading">
                <h3>${escapeHtml(area)}</h3>
                <p>${escapeHtml(areaCopy[area] || "Moduly robocze dostepne z panelu startowego.")}</p>
            </div>
            <div class="start-module-grid">
                ${modules.map((module) => `
                    <a class="start-module-card" href="${module.path}">
                        <span class="start-module-card__eyebrow">${escapeHtml(module.area || "Workspace")}</span>
                        <span class="start-module-card__title">${escapeHtml(module.label)}</span>
                        <span class="start-module-card__description">${escapeHtml(module.description || "")}</span>
                        <span class="start-module-card__footer">Otworz modul</span>
                    </a>
                `).join("")}
            </div>
        </section>
    `).join("");

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
})(window);
