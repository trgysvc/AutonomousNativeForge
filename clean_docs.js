const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'docs/reference/aurapos');

if (!fs.existsSync(dir)) process.exit(0);

const files = fs.readdirSync(dir);
const groups = {};

// Sadece .md dosyaları için
files.forEach(f => {
    if (!f.endsWith('.md')) return;
    
    // Asıl dosya ismini bul (başındaki tüm _ ve FAILED_ leri at)
    const baseName = f.replace(/^(_FAILED_|_)+/, '');
    
    if (!groups[baseName]) groups[baseName] = [];
    groups[baseName].push(f);
});

// Her grup için temizlik
for (const [baseName, groupFiles] of Object.entries(groups)) {
    // İstediğimiz format: tek alt çizgili (_dosya.md)
    const targetName = `_${baseName}`;
    
    // Eğer grupta targetName yoksa ama asıl dosya varsa, bir tane asıl dosyayı rename yapalım
    if (!groupFiles.includes(targetName)) {
        // En temiz ismi seç (mümkünse alt çizgisiz)
        const bestSource = groupFiles.includes(baseName) ? baseName : groupFiles[0];
        fs.renameSync(path.join(dir, bestSource), path.join(dir, targetName));
        console.log(`Renamed: ${bestSource} -> ${targetName}`);
        
        // Bu dosyayı gruptan sil ki aşağıda silinmesin
        const idx = groupFiles.indexOf(bestSource);
        if (idx > -1) groupFiles.splice(idx, 1);
    } else {
        // Zaten _dosya.md var, onu listeden çıkar (silinmesin)
        const idx = groupFiles.indexOf(targetName);
        if (idx > -1) groupFiles.splice(idx, 1);
    }
    
    // Kalan tüm kopyaları sil
    groupFiles.forEach(f => {
        fs.unlinkSync(path.join(dir, f));
        console.log(`Deleted: ${f}`);
    });
}
console.log("Cleanup complete.");
