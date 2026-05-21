# VitAIHealthSync (iOS / Xcode)

Apple Health adım ve kalori verilerini VitAI Node sunucusuna (`/api/watch-data`) gönderen **SwiftUI iOS uygulaması**.

## Xcode ile açma

1. Bu klasördeki proje dosyasını açın:

   **`VitAIHealthSync.xcodeproj`**

2. Xcode’da hedefi seçin: **VitAIHealthSync** → gerçek cihaz veya simülatör.
3. **Signing & Capabilities** altında kendi Apple Developer Team’inizi seçin (`DEVELOPMENT_TEAM` repoda örnek bir değer içerebilir).
4. Mac’te VitAI backend’i çalıştırın (`npm start`, varsayılan port **3000**).
5. Uygulamada VitAI hesabıyla giriş yapın; Mac’in LAN IP’sini girin (sunucu başlarken konsolda listelenir).

## Klasör yapısı

```
VitAIHealthSync/
├── VitAIHealthSync.xcodeproj/   ← Xcode proje dosyası (bunu açın)
├── VitAIHealthSync/             ← Kaynak kod, Info.plist, Assets, entitlements
├── Info-additions-reference.plist
└── README.md
```

## Gereksinimler

- Xcode 16+ (proje Swift 5, iOS 18.6+ deployment target)
- HealthKit yetkisi (`VitAIHealthSync.entitlements`)
- iPhone: **Ayarlar → Gizlilik ve Güvenlik → Yerel Ağ** — uygulama açık olmalı

## İlgili backend

Ana VitAI reposu kökünde: `routes/watch-data.js`, `server.js` (`/api/watch-data`).
