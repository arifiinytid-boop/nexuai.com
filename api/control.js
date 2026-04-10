// api/control.js
export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    const celebrationScript = `
        --[[ 
            SCRIPT CELEBRASI NEXUS AI 
            Dibuat khusus untuk FIINYTID25
        ]]
        local folder = workspace:FindFirstChild("NexusCelebration")
        if folder then folder:Destroy() end
        
        folder = Instance.new("Folder", workspace)
        folder.Name = "NexusCelebration"
        
        -- Buat Panggung Neon
        local stage = Instance.new("Part", folder)
        stage.Name = "NexusStage"
        stage.Size = Vector3.new(25, 1, 25)
        stage.Position = Vector3.new(0, 0.5, 0)
        stage.Anchored = true
        stage.Material = Enum.Material.Neon
        stage.Shape = Enum.PartType.Cylinder
        
        -- Buat Efek Api/Partikel
        local attachment = Instance.new("Attachment", stage)
        local particles = Instance.new("ParticleEmitter", attachment)
        particles.Rate = 50
        particles.Speed = NumberRange.new(20, 50)
        particles.SpreadAngle = Vector2.new(-180, 180)
        particles.LightEmission = 1
        particles.Color = ColorSequence.new(Color3.fromRGB(0, 255, 255), Color3.fromRGB(255, 0, 255))
        
        -- Animasi Warna Pelangi
        task.spawn(function()
            local hue = 0
            while folder.Parent do
                hue = (hue + 0.01) % 1
                stage.Color = Color3.fromHSV(hue, 1, 1)
                task.wait(0.05)
            end
        end)
        
        print("🔥 NEXUS AI: Panggung Selebrasi telah dibuat untuk FIINYTID25!")
    `;

    // Kirim perintah Injeksi Script ke Plugin
    return res.status(200).json({
        action: "inject_script",
        name: "NexusCelebration",
        code: celebrationScript
    });
}
