(function initLoginPage() {
    const form = document.getElementById("login-form");
    const loginInput = document.getElementById("login-input");
    const passwordInput = document.getElementById("password-input");
    const nextInput = document.getElementById("next-input");
    const submitButton = document.getElementById("login-submit");
    const messageBox = document.getElementById("login-message");

    if (!form || !loginInput || !passwordInput || !nextInput || !submitButton || !messageBox) {
        return;
    }

    const requestUrl = new URL(window.location.href);
    const nextValue = requestUrl.searchParams.get("next") || "/console";
    nextInput.value = nextValue;

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        setMessage("", false);
        submitButton.disabled = true;

        try {
            const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify({
                    login: loginInput.value.trim(),
                    password: passwordInput.value,
                    next: nextInput.value,
                }),
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Nie udalo sie zalogowac.");
            }

            window.location.replace(data.redirectTo || "/console");
        } catch (error) {
            setMessage(error.message || "Nie udalo sie zalogowac.", true);
        } finally {
            submitButton.disabled = false;
        }
    });

    function setMessage(text, visible) {
        messageBox.textContent = text;
        messageBox.classList.toggle("hidden", !visible);
    }
})();
