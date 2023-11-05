const isEmail = (email) => {
    const regex = /\S+@\S+\.\S+/;
    return regex.test(email);
}

const isPassword = (password) => {

    return password.length >= 8 && /\d/.test(password) && /[A-Z]/.test(password) && /[a-z]/.test(password);
}

module.exports = {
    isEmail,
    isPassword
}