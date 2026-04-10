// api/control.js - Bridge by NEXUS AI for FIINYTID25
let currentCommand = { action: "none", name: "Default", color: [255, 255, 255], code: "" };
let robloxLogs = []; // Menyimpan log dari console Roblox

export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'POST') {
        const data = req.body;
        
        if (data.type === "log") {
            // Jika data yang datang adalah Log/Error dari Roblox
            robloxLogs.push({ msg: data.msg, time: new Date().toLocaleTimeString(), level: data.level });
            if (robloxLogs.length > 20) robloxLogs.shift(); // Simpan 20 log terakhir saja
            return res.status(200).json({ status: "Log Received" });
        } else {
            // Jika data yang datang adalah Perintah dari Website
            currentCommand = {
                action: data.action || "none",
                name: data.name || "Cloud_Object",
                color: data.color || [255, 255, 255],
                code: data.code || ""
            };
            return res.status(200).json({ message: "Command Sent!" });
        }
    }

    if (req.method === 'GET') {
        // Website memanggil ini untuk melihat perintah & logs
        return res.status(200).json({ command: currentCommand, logs: robloxLogs });
    }
}
