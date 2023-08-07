const isEmail = (email) => {
    const regex = /\S+@\S+\.\S+/;
    return regex.test(email);
}

const isPassword = (password) => {
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,}$/;
    return regex.test(password);
}

module.exports = {
    isEmail,
    isPassword
}