# Going live: your steps, in detail

This is the how-to for every step on the launch checklist marked **You**. The
section numbers here are the "Guide §" numbers on the checklist. The steps
marked **Claude** are code, and Claude ticks them off on the checklist as they
are pushed.

Written in October 2026. Prices, menus and policies change. This session could
search the web but could not open Google's or the hosts' own pages, so check
each price and screen as you go. Where a menu isn't where this says, search
the console for its name. Sources are listed at the end.

## The plan in one picture

```
yourgame.com              the web version, plus the privacy policy, terms,
                          support page and app-ads.txt    (Cloudflare Pages)
play.yourgame.com         the game server: online matches, Founders,
                          progress, credits, name reports, crash reports
                          (Railway, or a small server of your own)
Google Play               the Android app
RevenueCat                who bought Supporter: Google Play Billing in the
                          app, Stripe on the web
AdMob / H5 Games Ads      the rewarded "XP boost" ad: AdMob in the app,
                          Google's H5 Games Ads on the web
GitHub Pages              stays the test build (§6)
```

## Costs at a glance

| What                            | Cost                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Google Play developer account   | $25, once                                                                                                                    |
| Domain (.com)                   | roughly $10–12 a year at Cloudflare                                                                                          |
| Game server                     | Railway Hobby: $5 a month, which includes $5 of usage. Hetzner: from about €4–5 a month in Europe, more in the US            |
| Web version hosting             | free (Cloudflare Pages)                                                                                                      |
| Support email forwarding        | free (Cloudflare Email Routing)                                                                                              |
| RevenueCat                      | free below a monthly revenue threshold. Third-party sources disagree on the threshold, so check revenuecat.com/pricing       |
| Stripe (web sales)              | 2.9% + 30¢ per sale in the US                                                                                                |
| Google's cut of Supporter       | Since June 30, 2026 in the US, UK and EEA: a 10% service fee plus a 5% billing fee, on your first $1M a year. Elsewhere: 15% |
| AdMob, AdSense                  | free. They pay you                                                                                                           |
| Apple developer account (later) | $99 a year                                                                                                                   |

## What to send Claude, and when

- **The final name** and the app ID you want (§1).
- **The domain** once it's bought (§2).
- **That the server is up**, with its address (§5). Claude doesn't need a login to your host.
- **AdMob**: the app ID, the rewarded ad unit ID and the app-ads.txt line (§10).
- **RevenueCat**: the two _public_ SDK keys (§9). Never paste a _secret_ key (`sk_…`) into a chat; it goes straight into the server's settings.
- **AdSense**: your publisher ID, if H5 Games Ads approves you (§10).
- **Your name or studio name** for the credits and the privacy policy.

---

## 1. Pick the final name

Do this first. The name goes into three places that are hard or impossible to
change later:

- **The app ID** (Android's package name, today `com.lanesiege.app`). Once a
  build is uploaded to Google Play, the app ID can **never** change. A new ID
  is a different app with no reviews or installs.
- **The domain** (§2).
- **The store listing**, and every screenshot with the name in it.

Before you commit to a name:

1. Search it on Google Play and the App Store. Skip it if a game with the same
   or a very similar name already exists.
2. Search the web for `"<name>" game`.
3. Check the domain is free (§2). A `.com` is best. `play<name>.com` or
   `<name>game.com` are fine if the bare one is taken.
4. Search the trademark databases: the USPTO's search (tmsearch.uspto.gov) in
   the US, and WIPO's Global Brand Database (branddb.wipo.int) for the rest of
   the world. A registered mark on a game name is a real risk. A lawyer is the
   only real answer, but a clean search is a good sign.
5. Check that the handle is free on the social sites you'll use.

**Send Claude** the name, and the app ID you want. The usual shape is your
domain backwards plus the game, all lowercase: for `stormkeep.com`, use
`com.stormkeep.game`. Only letters, digits, underscores and dots are allowed,
and each part has to start with a letter.

## 2. Buy the domain

**Recommended: Cloudflare Registrar.** It sells domains at cost (no markup
when you renew), and the DNS, the web version's hosting (§6) and the support
email (§7) all live in the same dashboard.

1. Make an account at dash.cloudflare.com. Turn on two-step login (Profile → Authentication).
2. Open **Domain Registration → Register Domains**, search for the name and buy it. WHOIS privacy is included, so your address isn't published with the domain.
3. Turn on auto-renew. A lapsed domain takes your game, its email and its server address down with it.

If you'd rather buy elsewhere (Porkbun, Namecheap), buy there and then add the
domain to a free Cloudflare account and change the nameservers to the two
Cloudflare gives you. The rest of this guide assumes the DNS is on Cloudflare.

You'll use two addresses: `yourgame.com` for the web version and the site,
and `play.yourgame.com` for the game server.

## 3. Google Play developer account

**Personal or organization?**

|                              | Personal                                                                         | Organization                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Who                          | You, as yourself                                                                 | A registered business                                                                               |
| Extra paperwork              | A government ID                                                                  | A D-U-N-S number (free from Dun & Bradstreet, but it can take up to 30 days) and business documents |
| The 14-day closed test (§16) | **Required**: 12 testers for 14 days in a row before you can release to everyone | Not required                                                                                        |
| Address shown on Google Play | Yes, once you sell anything (see below)                                          | The business address                                                                                |

**Your address will be public.** Google shows a full address on the store
listing of any developer who sells something, and Supporter counts. It comes
from your payments profile (§8). If you don't want your home address on
Google Play, use a business address: a virtual mailbox or registered-agent
service gives you one for a few dollars a month. Forming an LLC also gets you
the organization account and skips the closed test, but it takes weeks and
costs money. For most solo developers, **personal plus a mailbox address** is
the quickest path.

Steps for a personal account:

1. Pick the Google account the game will live under. A new one just for the
   game (like `yourgame.studio@gmail.com`) keeps it separate from your
   personal mail and is easier to share later. Turn on 2-Step Verification.
2. Go to **play.google.com/console/signup**, choose **Yourself**, and fill in:
   - the developer name, which is shown on the store (your name or a studio name);
   - a contact email and phone, which Google verifies;
   - how much Android experience you have, and what you plan to publish.
3. Pay the $25 fee.
4. Verify your identity with a government ID. This can take a few hours or a few days.
5. Verify that you own an Android phone. New personal accounts must do this
   from the **Play Console app**: on the console's Home page, open "Verify that
   you have access to an Android mobile device", scan the QR code with the
   phone, sign in with the **same** Google account and tap Verify. The phone has
   to run Android 10 or newer and not be rooted.

Android's new developer verification (enforced in some countries from
September 30, 2026, and worldwide in 2027) is covered by this. A Play account
whose identity is verified is already a verified developer. Check that the
Play Console Home page shows the app as registered once it exists.

## 4. Find your 12 testers

Only needed for a personal account. Google's rule: **at least 12 testers
opted in to a closed test for the last 14 days in a row** before you can apply
to release to everyone. If the count drops below 12, the 14 days start over.
Google also looks at whether the testers actually used the app, so twelve
installs that never open it can get the application refused.

- **Recruit 15 to 20**, so a couple dropping out doesn't reset the clock.
- Each tester needs a Google account and an Android phone, and must open your
  opt-in link and tap **Become a tester** (§16). Joining a group isn't enough.
- **Where to find them**: friends and family who game; a Discord or subreddit
  for indie or strategy games; game-dev communities that swap testing (you
  test theirs, they test yours). Paid "tester" services exist. Avoid ones that
  promise installs without play, since Google now checks engagement.
- **Make it easy**: create a Google Group (groups.google.com, e.g.
  `yourgame-testers`) and ask everyone to join it. You add the group to the
  closed test once (§16), and anyone who joins later is included.
- **Ask for real play**: a few matches a week over the 14 days, including some
  online quick matches, and one or two lines of feedback. That feedback is
  also what you'll describe when you apply for production access (§16).

## 5. Host the game server

The game server runs online matches and keeps the Founders, progress, saved
builds, the credits, name reports and crash reports. It needs to be:

- **always on**: matches live in its memory, so a free tier that goes to sleep drops them;
- **on HTTPS**: the Android app can only connect to a `wss://` address;
- **on a disk that survives restarts**: everything it keeps lives there;
- **one copy only**: don't scale it to two or more instances.

### Recommendations

| Host                     | About                                                       | Monthly cost                                                 | Notes                                                                        |
| ------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| **Railway** (start here) | Deploys straight from GitHub on every push. Point and click | $5 Hobby plan, which includes $5 of usage                    | Up to 5 GB of disk on Hobby. Support is the community Discord                |
| **Hetzner Cloud**        | A small Linux server of your own                            | From about €4–5 in Germany or Finland, more in the US        | The most power for the money. You look after updates. Backups cost 20% extra |
| **Fly.io**               | Driven from a command-line tool                             | A few dollars for a small machine, plus $0.15 per GB of disk | Machines from $2.19 a month (256 MB); 1 GB is about $6.70                    |
| **DigitalOcean**         | Like Hetzner                                                | $6 for 1 GB                                                  | Backups cost 20% extra                                                       |

Not these: Render's free tier sleeps after 15 minutes. Colyseus Cloud (from
$15 a month) is made for this game's multiplayer library, but check that it
keeps files on a disk before choosing it, because this server writes its
records to disk.

**Pick a location near most of your players.** If you don't know yet, a US
East location is a reasonable middle for North America and Europe.

### Railway, step by step

1. Sign up at **railway.com** with your GitHub account and choose the **Hobby** plan.
2. **New Project → Deploy from GitHub repo**, and pick this repository. Give
   Railway access to it when asked. Railway finds the repository's
   `Dockerfile` and builds the server from it.
3. Open the service's **Variables** and add:

   | Variable      | Value                                                                                             |
   | ------------- | ------------------------------------------------------------------------------------------------- |
   | `DATA_DIR`    | `/data`                                                                                           |
   | `ADMIN_TOKEN` | a long random password for the admin page (§17). Make one with a password manager, 32+ characters |
   | `TRUST_PROXY` | `1` (Railway sits in front of the server, so the server reads the real visitor address from it)   |

   Railway sets `PORT` by itself. Leave it alone.
   Later you'll add `REVENUECAT_SECRET_KEY` (§9).

4. Add a **volume** to the service (right-click the service, or the command
   palette: "Volume") and set its mount path to **`/data`**. This is the disk
   that survives restarts.
5. **Settings → Networking → Custom Domain**: enter `play.yourgame.com`.
   Railway shows a CNAME target. In Cloudflare, open the domain's **DNS** page
   and add a record: type **CNAME**, name **play**, target **what Railway
   showed**, proxy status **DNS only** (the grey cloud). Railway gets the
   HTTPS certificate by itself, usually within minutes.
6. Open **https://play.yourgame.com/health** in a browser. It should say `ok`.
7. Leave the replica count at **1**.
8. Turn on **backups** for the volume if Railway offers them on your plan,
   and download a backup from the admin page every week anyway (§17).

**Send Claude** the address. Claude then builds the app and the web version to
connect to it.

### Hetzner, step by step (if you'd rather have your own server)

1. Sign up at **hetzner.com/cloud** (it asks for ID or a card check).
2. Create a project and **Add Server**: a location near your players, image
   **Ubuntu 24.04**, the smallest shared-vCPU plan with 2 GB of memory or more,
   your SSH key (the page explains how to make one), and tick **Backups**.
3. Add a **firewall** allowing ports 22, 80 and 443, and attach it to the server.
4. In Cloudflare DNS, add an **A** record: name **play**, the server's IPv4
   address, **DNS only**.
5. Log in (`ssh root@<server address>`) and run:

   ```sh
   curl -fsSL https://get.docker.com | sh
   git clone https://github.com/<you>/<repository>.git game && cd game/deploy
   cp .env.example .env    # then edit .env: your domain and ADMIN_TOKEN
   docker compose up -d --build
   ```

   The `deploy/` folder has the server and Caddy, which fetches and renews
   the HTTPS certificate on its own.

6. To update later: `cd game && git pull && cd deploy && docker compose up -d --build`.

## 6. Host the web version

The web version is a separate build from the GitHub Pages test build. It lives
on your own domain, connects to your server, and leaves the test tools out.

**Cloudflare Pages (free):**

1. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**, and
   pick this repository.
2. Build settings:

   | Setting                | Value               |
   | ---------------------- | ------------------- |
   | Production branch      | `main`              |
   | Build command          | `npm run build:web` |
   | Build output directory | `dist`              |

3. Environment variables (production):

   | Variable       | Value                     |
   | -------------- | ------------------------- |
   | `NODE_VERSION` | `22`                      |
   | `VITE_SERVER`  | `wss://play.yourgame.com` |

4. **Save and Deploy**. When it finishes, open the project's **Custom domains**
   and add `yourgame.com` (and `www.yourgame.com` if you like). Cloudflare sets
   up the DNS and the certificate.

Every push to `main` then rebuilds both the web version and the test build.

**The GitHub Pages build** stays useful as the test build, with
`?progress=test` and the other test switches. It's public, though. To switch
it off at launch, open the repository's **Settings → Pages** and unpublish it,
or ask Claude to stop the deploy workflow.

## 7. Support email

Google Play requires a contact email on the listing, and the privacy policy
needs one too.

1. In Cloudflare, open the domain's **Email → Email Routing → Get started**.
2. Create the address `support@yourgame.com` and set the destination to your
   own inbox. Cloudflare sends that inbox a confirmation email. Click it.
3. Cloudflare adds the DNS records itself. Send a test message to check.

That receives mail. Replying from your own inbox is fine. If you want replies
to come _from_ `support@yourgame.com`, Gmail's "Send mail as" can do it with a
sending service like Brevo or Resend (each has a free tier).

## 8. Get paid by Google Play

1. In Play Console: **Settings → Payments profile** (sometimes under
   **Setup**). Create the profile:
   - legal name and address (this is the address Google shows publicly; see §3);
   - tax information (in the US, a W-9 inside Google's tax form; elsewhere,
     usually a W-8BEN);
   - a bank account. Google may verify it with a small test deposit.
2. Link it to the developer account if Play Console asks.

You can't create the Supporter product (§15) until this is done.

**What Google keeps** of a $4.99 Supporter sale: since June 30, 2026, in the
US, UK and EEA, a 10% service fee on your first $1M of earnings each year,
plus a 5% billing fee when the payment goes through Google Play's checkout,
which it does in the app. In other countries the older 15% applies.

## 9. RevenueCat and Stripe

RevenueCat keeps one record of who bought Supporter, whether they bought it in
the Android app (through Google Play) or on the web version (through Stripe).
The game server asks RevenueCat before it shows anyone's Supporter badge or
puts their name in the credits, so nobody can fake either.

**RevenueCat:**

1. Sign up at **revenuecat.com** and create a **Project** named after the game.
2. **Add an app → Google Play Store**, with the app ID from §1.
3. **Service account credentials.** RevenueCat needs permission to read your
   Google Play sales. Follow RevenueCat's guide, "Creating Play Service
   Credentials". In short:
   1. In the **Google Cloud Console**, open the project linked to your Play
      account and **enable the Google Play Android Developer API** (and the
      Google Play Developer Reporting API if it's listed).
   2. Create a **service account** and download a **JSON key** for it.
   3. In **Play Console → Users and permissions**, invite the service
      account's email address with the permissions RevenueCat's guide lists.
   4. Upload the JSON key in RevenueCat (**Project settings → Google Play app
      settings**).

   It can take **up to 36 hours** before the credentials work. Until then
   RevenueCat shows "Invalid Play Store credentials".

4. In **Product catalog**:
   - create an **entitlement** with the identifier `supporter`;
   - once the Play product exists (§15), add the product `supporter`, mark it
     **non-consumable**, and attach it to the `supporter` entitlement;
   - put it in the default **offering**.
5. **API keys**: copy the Google Play **public** SDK key (it starts `goog_`)
   and send it to Claude. Create a **secret** key (`sk_…`) and add it to the
   server's variables as `REVENUECAT_SECRET_KEY` (§5). Don't paste it into a
   chat.

**Stripe, for Supporter on the web:**

1. Sign up at **stripe.com**. As a solo developer, choose **individual / sole
   proprietor**. It asks for your legal name, address, tax ID (SSN or EIN in the
   US) and a bank account.
2. In RevenueCat, add a **Web** app using **Web Billing** and connect your
   Stripe account when it asks.
3. Create the web product: **Supporter**, a one-time price of $4.99, attached
   to the same `supporter` entitlement.
4. Send Claude the Web Billing **public** key (it starts `rcb_`).

Stripe takes 2.9% + 30¢ per card sale in the US.

## 10. Ads: AdMob in the app, H5 Games Ads on the web

### AdMob (the Android app)

1. Go to **admob.google.com**, sign in with the game's Google account and
   create an AdMob account (country, time zone, payment currency).
2. **Apps → Add app → Android**. When it asks whether the app is on a store
   yet, say **No**. You'll link the Play listing after release.
3. **Ad units → Add ad unit → Rewarded**. Name it "XP boost". Reward amount 1,
   reward item "boost". Create it.
4. Copy the **app ID** (`ca-app-pub-…~…`) and the **ad unit ID**
   (`ca-app-pub-…/…`) and send both to Claude. Until real ones are in, the
   game uses Google's test ads, which pay nothing.
5. **Privacy & messaging → European regulations → Create message**. Select
   the app, add your privacy policy address (§11), and **Publish**. Players in
   the EEA, UK and Switzerland must be asked for consent before ads, and
   Google requires this form or another certified one. Claude's code shows it
   and adds a button to change the answer later.
6. Add your **payment details** in AdMob. Google pays out once earnings pass
   its threshold, and mails a PIN to your address along the way to confirm it.
7. **Never tap your own live ads.** It gets AdMob accounts closed. Test with a
   test build, which uses test ads.

### app-ads.txt

AdMob checks that you're allowed to sell ads in your app by reading a file at
the root of the website on your Play listing.

1. In AdMob: **Apps → View all apps → app-ads.txt**. Copy the line it gives
   (it starts `google.com, pub-`).
2. Send it to Claude, who puts it in the web version at
   `https://yourgame.com/app-ads.txt`. It has to be at the domain's root:
   the GitHub Pages address can't serve it.
3. Put `https://yourgame.com` as the website on your Play listing (§13).
   AdMob looks within a day.

### H5 Games Ads (the web version)

AdMob only works inside the app. For rewarded ads on the web version, Google
has H5 Games Ads, a beta run through AdSense that you have to apply for.

1. Sign up at **adsense.google.com** and add your site, `yourgame.com`.
   AdSense reviews the site, so do this once the web version, the privacy
   policy and the support page are live (§6, §11).
2. Once AdSense approves the site, apply for **H5 Games Ads** from AdSense
   Help ("Sign up for H5 Games Ads"). Google decides case by case.
3. If you're approved, send Claude your publisher ID (`ca-pub-…`).

Until then the web version offers no ad. The game's other ways to earn XP are
unchanged.

## 11. Privacy policy, terms and support page

Google Play, AdMob, AdSense and Stripe all require a privacy policy at a public
web address. Claude drafts all three pages from what the game actually keeps:

- the player ID made on the device, and the names a player chooses (their
  player name, and the name for the credits);
- game progress, matches, saved builds, Founder numbers;
- name reports, and crash reports (which carry no player ID);
- visitors' internet addresses, held briefly by the server to stop abuse;
- purchases, made through Google Play or Stripe and checked through RevenueCat;
- what AdMob or AdSense collect for ads;
- who it goes to (Google, RevenueCat, Stripe, the hosts), how long it's kept,
  how to ask for it to be deleted (email support), and that the game isn't for
  children under 13.

**Your part:** read the drafts, add your name or company and contact address,
and they go live with the web version at `yourgame.com/privacy`,
`/terms` and `/support`. The drafts aren't legal advice. If you sell in the EU
or UK, or the game grows, have a lawyer look, or use a generator like Termly
or iubenda.

## 12. Play Console: create the app, then App content

**Create the app:** Play Console → **Create app**. Name (30 characters at
most), default language, **Game**, **Free**, then tick the declarations.

Then work through the **App content** page (Policy → App content, or the
dashboard's "Set up your app" list):

- **Privacy policy**: `https://yourgame.com/privacy`.
- **App access**: "All functionality is available without any access restrictions" (there's no login).
- **Ads**: Yes, the app contains ads.
- **Advertising ID**: Yes. Purposes: advertising, and fraud prevention and security. (AdMob uses it.)
- **Content rating**: start the questionnaire, category **Game**, and answer
  honestly: cartoon fantasy combat against monsters; no blood, sex, drugs or
  gambling; in-app purchases yes. When it asks about players interacting,
  say that players see each other's chosen names in online matches and there
  is no chat. Answer for what the game does, not what it mentions.
- **Target audience and content**: choose **13–15, 16–17 and 18+**. Picking any
  age under 13 brings in Google's Families policy, which restricts the ads
  and the online names. Answer the "appeals to children" question honestly.
- **News apps**: No. **Government apps**: No. **Financial features**: none.
  **Health**: No.
- **Data safety**: see below.

### Data safety: a starting point

You're responsible for these answers. Check them against the privacy policy
and against Google's own pages for AdMob and RevenueCat, which list what their
code collects.

| Data type (Google's category)                      | What it is in this game                                      | Collected | Shared                                | Why                            | Optional                |
| -------------------------------------------------- | ------------------------------------------------------------ | --------- | ------------------------------------- | ------------------------------ | ----------------------- |
| Personal info → Name                               | The player name and credits name a player chooses            | Yes       | No                                    | App functionality              | Yes (there's a default) |
| Device or other IDs                                | The player ID made on the device; the advertising ID (AdMob) | Yes       | Yes, to Google for ads                | App functionality; advertising | No                      |
| App activity → App interactions                    | Matches, progress, saved builds                              | Yes       | No                                    | App functionality              | No                      |
| App activity → Other user-generated content        | Name reports                                                 | Yes       | No                                    | App functionality              | Yes                     |
| App info and performance → Crash logs, Diagnostics | Crash reports                                                | Yes       | No                                    | Analytics                      | No                      |
| Financial info → Purchase history                  | Supporter, through Google Play and RevenueCat                | Yes       | No (RevenueCat is a service provider) | App functionality              | Yes                     |

Also: data is **encrypted in transit** (yes: HTTPS and WSS), and **users can
ask for their data to be deleted** (yes: by emailing support, and you delete
it from the admin page, §17). Check AdMob's current disclosure page for
anything else its code collects, such as approximate location from the IP
address.

## 13. Store listing

**Main store listing:**

| Field             | Limit                                                                                      | Who                                  |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| App name          | 30 characters                                                                              | You (§1)                             |
| Short description | 80 characters                                                                              | Claude drafts                        |
| Full description  | 4,000 characters                                                                           | Claude drafts                        |
| App icon          | 512 × 512 PNG, 32-bit with transparency, up to 1 MB                                        | Claude makes it                      |
| Feature graphic   | 1024 × 500, JPEG or 24-bit PNG, no transparency                                            | Claude makes it                      |
| Phone screenshots | 2 to 8, JPEG or 24-bit PNG, each side 320–3,840 px, long side at most twice the short side | Claude takes them from the real game |
| Promo video       | Optional, a YouTube link                                                                   | You, if you want one                 |

Category: **Game → Strategy**. Contact details: `support@yourgame.com`, and the
website `https://yourgame.com` (the one with app-ads.txt). Screenshots must
show the real game: no device frames or made-up scenes.

## 14. Upload key and the first upload

Google signs the app for the store (**Play App Signing**, on by default). You
sign each upload with your own **upload key**, which proves the upload is yours.

**Make the upload key.** The easiest way is **Android Studio** (free):

1. Install Android Studio and open the repository's `android` folder (Claude
   prepares it).
2. **Build → Generate Signed App Bundle → Android App Bundle → Create new…**.
   Choose a file name like `upload-key.jks`, a strong password, the alias
   `upload`, a validity of 25+ years, and your name.

Or, with Java installed, one command:

```sh
keytool -genkeypair -v -keystore upload-key.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

**Back it up twice**: the `.jks` file and its password in your password
manager, and a second copy offline (a USB stick in a drawer). Never put it in
the repository or a chat. If it's ever lost, Play Console can reset the upload
key, but that means a request to Google and a wait.

**Build and upload** (Claude sets up the release build, then you):

1. Build the signed bundle (`.aab`) with Android Studio, or with the GitHub
   workflow Claude adds, which signs it with secrets you add to the repository.
2. Play Console → **Test and release → Testing → Internal testing → Create new release**.
3. Upload the `.aab`, name the release (like `1.0.0`), **Save → Review → Start rollout**.
4. **Testers** tab: create an email list with yourself, copy the link, open it
   on your phone and install. Internal tests reach testers within minutes.
5. Look at the **Pre-launch report** a few hours later. Google runs the app on
   real devices and lists crashes and problems.

## 15. The Supporter product

You can only create it once a build with billing has been uploaded (§14) and
the payments profile is set (§8).

1. Play Console → **Monetize with Play → Products → One-time products → Create**.
2. **Product ID: `supporter`**. It can never be changed or reused, so type it carefully.
3. Name **Supporter**, a short description, and the price **$4.99**. Let Google
   set the prices for other countries.
4. **Activate** it.
5. Add it to RevenueCat (§9, step 4).
6. **Test purchases without paying**: Play Console → **Settings → License
   testing**, add your own Google account and your testers'. They buy with test
   cards and nobody is charged.

## 16. Closed test, production access, launch

**Closed test (personal accounts):**

1. Play Console → **Testing → Closed testing → Create track** (or use the
   default "Closed testing - Alpha").
2. **Testers**: add your Google Group (§4) or an email list.
3. **Countries/regions**: pick where your testers are.
4. **Create release**: upload the same `.aab` (or a newer one), then **Review
   and roll out**. A closed test is reviewed by Google, which can take a few days.
5. Once it's approved, copy the **opt-in link** and send it to the testers.
   Each must open it, tap **Become a tester**, then install from Google Play.
6. Watch the count on the Play Console dashboard. It needs **12 or more,
   opted in, for 14 days in a row**. Uploading newer builds during the test is
   fine, and expected.

**Apply for production access:** when the dashboard says you're eligible,
click **Apply for production**. It's a short form, a few hundred characters per
answer: how you recruited testers, how they used the app, what feedback they
gave, what you changed because of it, and why the app is ready. Be specific;
vague answers are a common reason for refusal. Google usually answers within
about a week.

**Launch:**

1. **Production → Create new release**, upload the `.aab`, pick the countries.
2. Consider a **staged rollout** (say 20% of people first) and raise it after a
   day or two of clean crash reports (§17).
3. **Review release → Start rollout**. Reviews take hours to days.
4. Put the web version live the same day (§6), if it isn't already.

## 17. Running the game

**The admin page:** `https://play.yourgame.com/admin`. Enter your
`ADMIN_TOKEN` once and the browser remembers it. It shows:

- **Name reports**: who was reported, how often, by how many people. Hide a
  name (that player shows as "Player XXXX" to everyone) or dismiss the reports.
  A name reported by several different players is hidden automatically until
  you look at it.
- **Crash reports**, grouped by error, with how often, which versions and
  what was on screen. Look after every release.
- **Founders** and **the credits**: who's who, and you can remove a credits
  name.
- **Delete a player** when someone emails asking for their data to be deleted.
- **Download a backup** of everything the server keeps. Do it weekly, and
  before any change of host.

**Also:**

- Play Console's **Android vitals** shows crashes and freezes of the app
  itself; the admin page shows errors inside the game.
- Answer support email. Deletion requests: delete the player on the admin
  page, then reply.
- During the closed test, playtest the two open balance questions: whether
  every seat is equally fair, and the boss mix. Try the game on a cheap Android
  phone too, and check the frame rate.

## 18. Later: iPhone

When the Android version is settled:

- The **Apple Developer Program** costs $99 a year. Building for iOS needs a
  Mac, or a cloud Mac service.
- Apple requires a **Restore Purchases** button for Supporter, and for names
  other players can see, a way to **report** and **block** them and a contact
  address.
- If ads track across apps, Apple's **tracking permission** prompt comes first.
- RevenueCat handles App Store purchases as well, so Supporter carries over.

---

## Sources

- Google Play testing requirement for new personal accounts: [Play Console Help](https://support.google.com/googleplay/android-developer/answer/14151465), [ExtendsClass, 2026](https://extendsclass.com/blog/google-plays-closed-testing-requirement-what-developers-need-to-know-in-2026), [Testers Community: production access answers](https://www.testerscommunity.com/guides/google-play-production-access-form-answers), [OnTest: review times 2026](https://ontest.app/blog/google-play-closed-testing-review-time-2026)
- Device verification for new personal accounts: [Play Console Help](https://support.google.com/googleplay/android-developer/answer/14316361)
- Developer address shown on Google Play: [Play Console Help](https://support.google.com/googleplay/android-developer/answer/13634081?hl=en)
- Android developer verification, 2026: [Android Developers](https://developer.android.com/developer-verification/guides?hl=en)
- Fees from June 30, 2026: [Android Developers Blog](https://android-developers.googleblog.com/2026/06/play-expanded-billing.html), [9to5Google](https://9to5google.com/2026/06/24/google-play-store-external-billing-june-30/), [Play Console Help: service fees](https://support.google.com/googleplay/android-developer/answer/112622?hl=en)
- One-time products: [Play Console Help](https://support.google.com/googleplay/android-developer/answer/1153481?hl=en), [ChromeOS: Play Console setup for billing](https://chromeos.dev/en/publish/play-console-setup-for-billing)
- Store listing assets: [Play Console Help](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en), [AppRadar, 2026](https://appradar.com/blog/android-app-screenshot-sizes-and-guidelines-for-google-play)
- Content rating: [Play Console Help](https://support.google.com/googleplay/android-developer/answer/9898843?hl=en)
- Data safety: [Google Play Help](https://support.google.com/googleplay/answer/11416267?hl=en), [AdMob data disclosure](https://developers.google.com/admob/android/privacy/play-data-disclosure)
- AdMob consent message: [AdMob Help](https://support.google.com/admob/answer/10113207?hl=en)
- app-ads.txt: [AdMob developer guide](https://developers.google.com/admob/android/next-gen/app-ads), [AdMob Help](https://support.google.com/admob/answer/9363762?hl=en)
- H5 Games Ads: [AdSense Help](https://support.google.com/adsense/answer/1705831?hl=en), [AdSense: H5 Games Ads](https://adsense.google.com/start/h5-games-ads/)
- RevenueCat: [Web Billing](https://www.revenuecat.com/docs/web/web-billing/overview), [Stripe integration](https://revenuecat.com/docs/web/integrations/stripe), [Play service credentials](https://www.revenuecat.com/docs/service-credentials/creating-play-service-credentials), [restoring purchases](https://www.revenuecat.com/docs/getting-started/restoring-purchases)
- Railway: [plans](https://docs.railway.com/pricing/plans), [Dockerfiles](https://docs.railway.com/guides/dockerfiles)
- Fly.io: [pricing](https://fly.io/pricing.md), [October 2026 change](https://www.buildmvpfast.com/blog/fly-io-pricing-2026-ram-increase-vs-hetzner)
- Hetzner: [Better Stack review](https://betterstack.com/community/guides/web-servers/hetzner-cloud-review/), [CX22 pricing 2026](https://astro-web-em9.pages.dev/posts/hetzner-cx22-pricing-2026/)
- DigitalOcean: [pricing 2026](https://diyai.io/ai-tools/hosting/digitalocean-pricing/)
- Render: [free tier and plans](https://temps.sh/blog/render-pricing-2026)
- Colyseus Cloud: [pricing](https://www.colyseus.io/pricing)
- Cloudflare Pages limits: [Cloudflare docs](https://developers.cloudflare.com/pages/platform/limits)
- Cloudflare Email Routing: [Mecanik guide](https://mecanik.dev/en/posts/cloudflare-email-routing-free-custom-domain-email/)
