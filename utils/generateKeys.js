function generateKeys(amount) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const keys = [];

    for (let i = 0; i < amount; i++) {
        let key = '';
        for (let j = 0; j < 16; j++) {
            key += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        keys.push(key);
    }

    return keys;
}

module.exports = generateKeys;