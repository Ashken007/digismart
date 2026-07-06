(function () {
    var REGISTERED_USERS_KEY = "digismartRegisteredUsers";
    var CURRENT_USER_KEY = "digismartCurrentUser";
    var form = document.getElementById("login-form");
    var registerForm = document.getElementById("register-form");
    var loginContent = document.querySelector(".login-content");
    var loginMobileInput = document.getElementById("login");
    var passwordInput = document.getElementById("password");
    var captchaInput = document.getElementById("captcha");
    var captchaCanvas = document.getElementById("captcha-canvas");
    var refreshCaptchaButton = document.getElementById("reload");
    var showRegisterButton = document.getElementById("show-register");
    var showLoginButton = document.getElementById("show-login");
    var firstNameInput = document.getElementById("first-name");
    var lastNameInput = document.getElementById("last-name");
    var usernameInput = document.getElementById("username");
    var registerMobileInput = document.getElementById("mobile-number");
    var registerEmailInput = document.getElementById("email");
    var genderInput = document.getElementById("gender");
    var registerPasswordInput = document.getElementById("register-password");
    var confirmPasswordInput = document.getElementById("confirm-password");
    var modal = document.getElementById("validation-modal");
    var message = document.getElementById("validation-message");
    var okButton = document.getElementById("validation-ok");
    var fieldToFocus = null;
    var afterValidationClose = null;
    var captchaCode = "";
    var loginBackgroundKey = "digismartLoginBackgroundImage";

    function randomCaptchaCode() {
        var characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var code = "";

        for (var index = 0; index < 5; index += 1) {
            code += characters.charAt(Math.floor(Math.random() * characters.length));
        }

        return code;
    }

    function drawCaptcha() {
        var context = captchaCanvas.getContext("2d");
        var width = captchaCanvas.width;
        var height = captchaCanvas.height;

        captchaCode = randomCaptchaCode();
        context.clearRect(0, 0, width, height);
        context.fillStyle = "#f8f8f8";
        context.fillRect(0, 0, width, height);

        for (var line = 0; line < 5; line += 1) {
            context.beginPath();
            context.moveTo(Math.random() * width, Math.random() * height);
            context.lineTo(Math.random() * width, Math.random() * height);
            context.strokeStyle = line % 2 === 0 ? "#8dc63f" : "#874aa0";
            context.lineWidth = 1;
            context.stroke();
        }

        context.font = "bold 26px Arial, Helvetica, sans-serif";
        context.textBaseline = "middle";

        for (var charIndex = 0; charIndex < captchaCode.length; charIndex += 1) {
            context.save();
            context.translate(14 + charIndex * 20, height / 2);
            context.rotate((Math.random() - 0.5) * 0.35);
            context.fillStyle = "#111111";
            context.fillText(captchaCode.charAt(charIndex), 0, 1);
            context.restore();
        }
    }

    function applyLoginBackground() {
        var backgroundImage = localStorage.getItem(loginBackgroundKey);

        if (backgroundImage) {
            document.documentElement.style.setProperty("--login-panel-bg-image", 'url("' + backgroundImage + '")');
            return;
        }

        document.documentElement.style.removeProperty("--login-panel-bg-image");
    }

    function showValidation(text, targetField, callback) {
        message.textContent = text;
        fieldToFocus = targetField;
        afterValidationClose = callback || null;
        modal.hidden = false;
        okButton.focus();
    }

    function closeValidation() {
        modal.hidden = true;

        if (afterValidationClose) {
            var callback = afterValidationClose;
            afterValidationClose = null;
            callback();
            return;
        }

        if (fieldToFocus) {
            fieldToFocus.focus();
            fieldToFocus = null;
        }
    }

    function isValidEmailFormat(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    function isValidMobileNumber(value) {
        return /^[0-9]{10}$/.test(value);
    }

    function getRegisteredUsers() {
        var users = localStorage.getItem(REGISTERED_USERS_KEY);

        if (!users) {
            return [];
        }

        try {
            return JSON.parse(users);
        } catch (error) {
            return [];
        }
    }

    function saveRegisteredUsers(users) {
        localStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(users));
    }

    function findRegisteredUser(mobileNumber, password) {
        return getRegisteredUsers().find(function (user) {
            return user.mobileNumber === mobileNumber && user.password === password;
        });
    }

    function showLoginLayout() {
        registerForm.classList.add("d-none");
        form.classList.remove("d-none");
        loginContent.classList.remove("is-registering");
        loginMobileInput.focus();
    }

    function showRegisterLayout() {
        form.classList.add("d-none");
        registerForm.classList.remove("d-none");
        loginContent.classList.add("is-registering");
        firstNameInput.focus();
    }

    loginMobileInput.addEventListener("input", function () {
        loginMobileInput.value = loginMobileInput.value.replace(/\D/g, "").slice(0, 10);
    });

    form.addEventListener("submit", function (event) {
        var mobileValue = loginMobileInput.value.trim();
        var passwordValue = passwordInput.value.trim();

        event.preventDefault();

        if (mobileValue === "") {
            event.preventDefault();
            showValidation("Please enter mobile number", loginMobileInput);
            return;
        }

        if (!isValidMobileNumber(mobileValue)) {
            event.preventDefault();
            showValidation("Please enter valid mobile number", loginMobileInput);
            return;
        }

        if (passwordValue === "") {
            event.preventDefault();
            showValidation("Please enter user password", passwordInput);
            return;
        }

        if (captchaInput.value.trim() === "") {
            event.preventDefault();
            showValidation("Please enter the captcha code", captchaInput);
            return;
        }

        if (captchaInput.value.trim().toUpperCase() !== captchaCode) {
            event.preventDefault();
            showValidation("Please enter the correct captcha code", captchaInput);
            captchaInput.value = "";
            drawCaptcha();
            return;
        }

        var registeredUser = findRegisteredUser(mobileValue, passwordValue);

        if (!registeredUser) {
            showValidation("The user does not exist", loginMobileInput);
            return;
        }

        localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(registeredUser));
        window.location.href = "dashboard.html";
    });

    registerForm.addEventListener("submit", function (event) {
        var firstName = firstNameInput.value.trim();
        var lastName = lastNameInput.value.trim();
        var username = usernameInput.value.trim();
        var mobileNumber = registerMobileInput.value.trim();
        var email = registerEmailInput.value.trim();
        var gender = genderInput.value;
        var password = registerPasswordInput.value.trim();
        var confirmPassword = confirmPasswordInput.value.trim();
        var users = getRegisteredUsers();

        event.preventDefault();

        if (firstName === "") {
            showValidation("Please enter first name", firstNameInput);
            return;
        }

        if (lastName === "") {
            showValidation("Please enter last name", lastNameInput);
            return;
        }

        if (username === "") {
            showValidation("Please enter username", usernameInput);
            return;
        }

        if (mobileNumber === "") {
            showValidation("Please enter mobile number", registerMobileInput);
            return;
        }

        if (!isValidMobileNumber(mobileNumber)) {
            showValidation("Please enter valid mobile number", registerMobileInput);
            return;
        }

        if (email === "") {
            showValidation("Please enter email id", registerEmailInput);
            return;
        }

        if (!isValidEmailFormat(email)) {
            showValidation("Enter valid email id format", registerEmailInput);
            return;
        }

        if (gender === "") {
            showValidation("Please select gender", genderInput);
            return;
        }

        if (password === "") {
            showValidation("Please enter password", registerPasswordInput);
            return;
        }

        if (confirmPassword === "") {
            showValidation("Please enter confirm password", confirmPasswordInput);
            return;
        }

        if (password !== confirmPassword) {
            showValidation("Password and confirm password should be same", confirmPasswordInput);
            return;
        }

        if (users.some(function (user) { return user.mobileNumber === mobileNumber; })) {
            showValidation("Mobile number already registered", registerMobileInput);
            return;
        }

        users.push({
            firstName: firstName,
            lastName: lastName,
            username: username,
            mobileNumber: mobileNumber,
            email: email,
            gender: gender,
            password: password
        });
        saveRegisteredUsers(users);

        registerForm.reset();
        passwordInput.value = "";
        captchaInput.value = "";
        drawCaptcha();
        showValidation("Registration successful. Please login.", loginMobileInput, showLoginLayout);
    });

    okButton.addEventListener("click", closeValidation);

    showRegisterButton.addEventListener("click", showRegisterLayout);
    showLoginButton.addEventListener("click", showLoginLayout);

    refreshCaptchaButton.addEventListener("click", function () {
        captchaInput.value = "";
        drawCaptcha();
        captchaInput.focus();
    });

    modal.addEventListener("click", function (event) {
        if (event.target === modal) {
            closeValidation();
        }
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && !modal.hidden) {
            closeValidation();
        }
    });

    drawCaptcha();
    applyLoginBackground();
})();
