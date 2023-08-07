

const hash = async (password) => {
    const { sha256 } = await import('crypto-hash');
    return await sha256(password);
};

const compare = async (password, hash) => {
    const { sha256 } = await import('crypto-hash');
    const hashedPassword = await sha256(password);
    return hashedPassword === hash;
};

module.exports = { hash, compare };;