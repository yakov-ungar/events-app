# Events app (Android)

Phone app for your events. It keeps its own copy on the phone (works offline) and syncs with your website through Supabase.
now im checking if the updates are working

## Get the APK (GitHub builds it for you)
1. Create a free account at github.com and a **new private repository** (for example `events-app`). Private matters: the repository contains the app's signing key.
2. In the repository click **Add file > Upload files**, then drag in everything from this folder (the folders `www`, `resources`, `scripts`, `signing`, `.github`, and the loose files). Click **Commit changes**.
   - If the `.github` folder did not upload (hidden folders can be skipped), use **Add file > Create new file**, type `.github/workflows/build-apk.yml` as the name and paste the contents of that file from this folder.
3. Open the **Actions** tab. The "Build APK" run starts by itself and takes about 5 to 8 minutes. If it does not start, click "Build APK" > **Run workflow**.
4. When it shows a green check, open the run and download **events-app-apk** at the bottom (a zip containing `app-debug.apk`). Unzip it and copy the APK to your phone.
5. On the phone open the APK and allow "install unknown apps" when asked.
6. Open the app. In Settings enter your Supabase project URL and the **publishable** key, and the email and password of the user you created in Supabase. Tap Sign in.

To skip typing the URL and key on the phone, put them in `www/config.js` before uploading (the publishable key is meant to be inside apps; never put the secret key there).

## Updating
Change any file in the repository (or click Run workflow again). A new APK is built; installing it over the old one keeps your data because every build uses the same signing key.

## If the build fails
Open the failed run, click the red step, and send me the last 30 lines of the log.
