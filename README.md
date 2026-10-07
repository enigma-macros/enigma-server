# Enigma Macros: website + license server

Ye folder aapki website, login, payment approval, admin panel aur license check, sab ek saath chalata hai.
Isme koi npm package nahi lagta. Sirf **Node.js 18 ya naya** chahiye (nodejs.org se LTS download karo).

## Ye kaise kaam karta hai

1. Customer website pe **Login with Discord** karta hai.
2. Wo plan chunta hai (7 days Rs 100, 30 days Rs 300, Lifetime Rs 1500) aur UPI QR se pay karta hai.
3. Wo 12 digit **UTR number** daalta hai. Order "Waiting for approval" mein chala jata hai.
4. Aap `/admin` pe apne bank / UPI app mein payment check karke **Approve** dabate ho.
5. License usi pal shuru ho jata hai. 7 days ka plan approve hone ke time se 7 din chalta hai.
6. Customer dashboard se key copy karta hai aur client (`Enigma.ahk`) download karta hai.
7. Client har 10 minute mein server se plan check karta hai. Plan khatam hote hi macros band ho jate hain.

Naya plan kharidne par naye din purane bache hue dino ke upar jud jate hain. Lifetime kabhi expire nahi hota.

## Setup (pehli baar)

**1. Discord app banao**
- discord.com/developers/applications -> New Application
- OAuth2 -> Redirects -> `https://aapka-domain.com/auth/callback` add karo (BASE_URL ke saath bilkul same)
- Client ID aur Client Secret copy karo

**2. `.env` file banao**
- `.env.example` ko copy karke naam `.env` rakho aur bharo:
  - `BASE_URL` = aapki site ka address (https wala, bina `/` ke)
  - `SESSION_SECRET` = 30+ random characters
  - `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`
  - `ADMIN_IDS` = aapki Discord User ID (Discord Settings -> Advanced -> Developer Mode on, phir apne naam pe right click -> Copy User ID)
  - `UPI_ID` = jahan payment lena hai (bank account number ya IFSC yahan nahi chahiye)

**3. Chalao**
```
node server.js
```
Site `http://localhost:3000` pe khulegi.

**4. Apne PC pe test karna (bina Discord ke)**
`.env` mein `DEV_MODE=1` likho, server restart karo, aur browser mein kholo:
`http://localhost:3000/auth/dev?id=111111111111111111&name=Test`
(`ADMIN_IDS` mein bhi wahi id daalo, to `/admin` khul jayega.)
**Live server pe `DEV_MODE` kabhi mat rakhna** (production mein `NODE_ENV=production` set karo, tab ye apne aap band rehta hai).

## Live karna

Site ko internet pe aisi jagah chalana hoga jahan Node chalta ho aur **files bachi rahein** (VPS, ya Railway jaisa host jisme volume/disk ho). Customers ka data `data/enigma.json` mein hai. Agar host restart pe files mita deta hai to saare licenses chale jayenge, isliye `DB_PATH` ko persistent disk pe rakho. HTTPS zaroori hai (Discord login aur cookies ke liye) aur `NODE_ENV=production` set karo.
Backup ke liye `data/enigma.json` ko kabhi kabhi copy kar lena.

## Roz ka kaam

- `https://aapka-domain.com/admin` kholo (apne admin Discord se login hone ke baad).
- **Pending payments** mein UTR aur amount apne UPI app se match karke Approve / Reject karo.
- Dost ya giveaway ke liye "Give a plan manually" use karo.
- Customer ka PC badal gaya to **Reset PC**. Wo khud bhi dashboard se 7 din mein ek baar kar sakta hai.
- Galat use par **Revoke**.

## AHK client

- `private/Enigma.ahk` wahi aapka client hai, bas license check jodha gaya hai. Macros waise ke waise hain.
- Customer ise dashboard se download karta hai. Download ke time file mein server ka address (`BASE_URL`) apne aap bhar jata hai.
  Seedhi file khologe to "no server address" ka message aayega, ye normal hai.
- Client mein tray icon -> **License...** se key badli ja sakti hai.
- Naya version dena ho to bas `private/Enigma.ahk` replace kar do.

## Zaroori baatein

- **AHK file ko bypass kiya ja sakta hai**, kyunki script plain text hoti hai. Ahk2Exe se `.exe` banake dene se thoda mushkil ho jata hai, par 100% safe koi tarika nahi. Aage ke liye macro steps ko server se bhejna sabse achha upay hai.
- UPI payment ka automatic confirm personal UPI ID se nahi ho sakta. Isliye ye approval wala tarika hai. Automatic chahiye to Razorpay / Cashfree jod sakte hain (KYC lagta hai).
- `.env` kisi ko mat dena. Isme Discord secret aur session secret hai.
