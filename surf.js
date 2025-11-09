process.removeAllListeners("warning");

const { QUIVER } = require("./modules/quiver");

const quiver = new QUIVER({
    cargs: process.argv
});
quiver.listen();
