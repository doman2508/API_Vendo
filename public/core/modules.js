(function initVendoModules(global) {
    const modules = [
        {
            id: "start",
            path: "/console",
            label: "Start",
            navLabel: "Start",
            area: "Workspace",
            order: 10,
            layout: "standard",
            description: "Panel startowy i skroty do modulow roboczych.",
            showInNav: true,
            showInStart: false,
        },
        {
            id: "admin",
            path: "/admin",
            label: "Administracja",
            navLabel: "Administracja",
            area: "Administracja",
            order: 15,
            layout: "standard",
            description: "Konta, role i dostep do modulow roboczych.",
            showInNav: true,
            showInStart: true,
        },
        {
            id: "zapotrzebowanie",
            path: "/zapotrzebowanie",
            label: "Zapotrzebowanie",
            navLabel: "Zapotrzebowanie",
            area: "Zakupy i planowanie",
            order: 20,
            layout: "standard",
            description: "",
            showInNav: true,
            showInStart: true,
        },
        {
            id: "production-dashboard",
            path: "/production-dashboard",
            label: "Produkcja",
            navLabel: "Produkcja",
            area: "Produkcja",
            order: 30,
            layout: "dashboard",
            description: "Dashboard stanowisk, przeglad pracy i ekran hali.",
            showInNav: true,
            showInStart: true,
        },
        {
            id: "mes",
            path: "/mes",
            label: "MES",
            navLabel: "MES",
            area: "Produkcja",
            order: 40,
            layout: "standard",
            description: "Diagnostyka pieca, partie KKW i administracja impulsami MES.",
            showInNav: true,
            showInStart: true,
        },
        {
            id: "kosztykkw",
            path: "/kosztykkw",
            label: "Koszty KKW",
            navLabel: "Koszty KKW",
            area: "Analizy",
            order: 50,
            layout: "standard",
            description: "Rozbicie kosztow KKW na materialy, operacje i dokumenty zlecenia.",
            showInNav: true,
            showInStart: true,
        },
        {
            id: "rentownosc",
            path: "/rentownosc",
            label: "Rentownosc",
            navLabel: "Rentownosc",
            area: "Analizy",
            order: 60,
            layout: "standard",
            description: "Rentownosc faktur sprzedazy i porownanie kosztow KKW do ceny FV.",
            showInNav: true,
            showInStart: true,
        },
        {
            id: "piaskownica",
            path: "/piaskownica",
            label: "Piaskownica",
            navLabel: "Piaskownica",
            area: "Integracje",
            order: 70,
            layout: "standard",
            description: "Miejsce do testowania endpointow i eksperymentow z danymi Vendo.",
            showInNav: true,
            showInStart: true,
        },
        {
            id: "mes-operator",
            path: "/mes/operator",
            label: "MES Operator",
            navLabel: "MES Operator",
            area: "Produkcja",
            order: 80,
            layout: "operator",
            description: "Tryb stanowiskowy dla operatora pieca i szybkiego skanowania partii.",
            showInNav: false,
            showInStart: true,
            compactBackPath: "/mes",
            compactBackLabel: "MES admin",
        },
    ];

    function sortModules(left, right) {
        return (left.order || 0) - (right.order || 0);
    }

    function getModuleById(id) {
        return modules.find((module) => module.id === id) || null;
    }

    function getModuleByPath(pathname) {
        return modules.find((module) => module.path === pathname) || null;
    }

    function getNavigationModules() {
        return modules.filter((module) => module.showInNav !== false).slice().sort(sortModules);
    }

    function getStartModules() {
        return modules.filter((module) => module.showInStart !== false).slice().sort(sortModules);
    }

    global.VendoModules = {
        all: modules.slice().sort(sortModules),
        getModuleById,
        getModuleByPath,
        getNavigationModules,
        getStartModules,
    };
})(window);
