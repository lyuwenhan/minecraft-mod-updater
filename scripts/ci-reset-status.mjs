import fs from "node:fs";
const text = `${JSON.stringify({needsUpdate:false,description:""},null,"\t")}\n`;
fs.writeFileSync("status.json", text, "utf8");
console.log("Reset status.json to needsUpdate: false and empty description");
