module.exports = async (len = 10, onlyDigits = false) => {
    let alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (onlyDigits) {
        alphabet = '0123456789';
    }

    const { customAlphabet } = await import('nanoid');
    const nanoid = customAlphabet(alphabet, len);
    return nanoid();
};