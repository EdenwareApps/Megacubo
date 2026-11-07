package tv.megacubo.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private static final String TAG = "AppUpdater";
    private static final String PREFS = "app_updater";
    private static final String DEFAULT_MANIFEST_URL = "https://stats.megacubo.net/data/configure.json";
    private static final String DEFAULT_GITHUB_REPO = "EdenwareApps/Megacubo";
    private static final long GITHUB_CACHE_TTL_MS = 6L * 60L * 60L * 1000L;
    private static final String PENDING_FILE_NAME = "megacubo-update.apk";

    private volatile boolean downloading = false;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---------------------------------------------------------------- helpers

    private static long parseNumber(String value) {
        if (value == null) return 0;
        StringBuilder digits = new StringBuilder();
        for (int i = 0; i < value.length(); i++) {
            char ch = value.charAt(i);
            if (ch >= '0' && ch <= '9') {
                digits.append(ch);
            } else if (digits.length() > 0) {
                break;
            }
        }
        if (digits.length() == 0) return 0;
        try {
            return Long.parseLong(digits.toString());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    // Same scheme used by build.gradle's getVersionCodeFromVersionName
    private static long versionCodeFromName(String versionName) {
        if (versionName == null) return 0;
        String value = versionName.trim();
        if (value.startsWith("v") || value.startsWith("V")) {
            value = value.substring(1);
        }
        int dash = value.indexOf('-');
        if (dash > 0) {
            value = value.substring(0, dash);
        }
        String[] parts = value.split("\\.");
        long major = parts.length > 0 ? parseNumber(parts[0]) : 0;
        long minor = parts.length > 1 ? parseNumber(parts[1]) : 0;
        long patch = parts.length > 2 ? parseNumber(parts[2]) : 0;
        return major * 10000L + minor * 100L + patch;
    }

    private static long currentVersionCode(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= 28) {
                return info.getLongVersionCode();
            }
            return info.versionCode;
        } catch (Exception e) {
            Log.w(TAG, "Could not read current version code", e);
            return 0;
        }
    }

    private static String currentVersionName(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return info.versionName == null ? "" : info.versionName;
        } catch (Exception e) {
            return "";
        }
    }

    private boolean canRequestPackageInstalls() {
        if (Build.VERSION.SDK_INT >= 26) {
            return getContext().getPackageManager().canRequestPackageInstalls();
        }
        return true;
    }

    private static String readStream(InputStream stream) throws IOException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, "UTF-8"));
        StringBuilder builder = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            builder.append(line).append('\n');
        }
        reader.close();
        return builder.toString();
    }

    private HttpURLConnection openConnection(String address, String accept, int timeoutMs) throws IOException {
        String current = address;
        for (int redirect = 0; redirect < 6; redirect++) {
            HttpURLConnection connection = (HttpURLConnection) new URL(current).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(timeoutMs);
            connection.setReadTimeout(timeoutMs * 2);
            connection.setRequestProperty("User-Agent", "Megacubo-AppUpdater/" + currentVersionName(getContext()));
            connection.setRequestProperty("Accept", accept);
            int code = connection.getResponseCode();
            if (code >= 300 && code < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new IOException("Redirect without location: " + current);
                current = location;
                continue;
            }
            if (code >= 400) {
                connection.disconnect();
                throw new IOException("HTTP " + code + " for " + current);
            }
            return connection;
        }
        throw new IOException("Too many redirects for " + address);
    }

    private String fetchText(String address, int timeoutMs) throws IOException {
        HttpURLConnection connection = openConnection(address, "application/json, text/plain, */*", timeoutMs);
        try {
            return readStream(connection.getInputStream());
        } finally {
            connection.disconnect();
        }
    }

    // ------------------------------------------------------------- candidates

    private JSObject candidate(String versionName, String url, String sha256, String notes, String source, long size) {
        JSObject candidate = new JSObject();
        candidate.put("versionName", versionName);
        candidate.put("versionCode", versionCodeFromName(versionName));
        candidate.put("url", url);
        candidate.put("sha256", sha256 == null ? "" : sha256);
        candidate.put("notes", notes == null ? "" : notes);
        candidate.put("source", source);
        candidate.put("size", size);
        return candidate;
    }

    private JSObject checkManifest(String manifestUrl) throws Exception {
        JSONObject root = new JSONObject(fetchText(manifestUrl, 10000));
        JSONObject android = root.optJSONObject("android");
        if (android == null) return null;

        String versionName = android.optString("versionName", "");
        if (versionName.isEmpty()) versionName = android.optString("version", "");
        if (versionName.isEmpty()) return null;

        String url = android.optString("url", "");
        if (url.isEmpty()) url = android.optString("apk", "");
        if (url.isEmpty()) url = android.optString("download", "");
        if (url.isEmpty()) return null;

        String notes = android.optString("notes", "");
        if (notes.isEmpty()) notes = android.optString("changelog", "");

        return candidate(versionName, url, android.optString("sha256", ""), notes, "manifest", android.optLong("size", 0));
    }

    private static int apkScore(String name) {
        String lower = name.toLowerCase(Locale.US);
        if (!lower.endsWith(".apk")) return -1;
        if (lower.contains("universal")) return 100;
        if (lower.contains("arm64") || lower.contains("armeabi") || lower.contains("x86")) return 10;
        return 50;
    }

    private JSObject parseGithubRelease(String json) throws Exception {
        JSONObject release = new JSONObject(json);
        String tag = release.optString("tag_name", "");
        if (tag.isEmpty()) tag = release.optString("name", "");
        if (tag.isEmpty()) return null;

        JSONArray assets = release.optJSONArray("assets");
        if (assets == null) return null;

        String bestUrl = "";
        String bestName = "";
        long bestSize = 0;
        int bestScore = -1;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.optJSONObject(i);
            if (asset == null) continue;
            String name = asset.optString("name", "");
            int score = apkScore(name);
            if (score > bestScore) {
                String url = asset.optString("browser_download_url", "");
                if (url.isEmpty()) continue;
                bestScore = score;
                bestUrl = url;
                bestName = name;
                bestSize = asset.optLong("size", 0);
            }
        }
        if (bestUrl.isEmpty()) return null;

        JSObject candidate = candidate(tag, bestUrl, "", release.optString("body", ""), "github", bestSize);
        candidate.put("assetName", bestName);
        candidate.put("releaseUrl", release.optString("html_url", ""));
        return candidate;
    }

    private JSObject checkGithub(String repo) throws Exception {
        SharedPreferences preferences = prefs();
        long cachedAt = preferences.getLong("github_cached_at", 0);
        String cached = preferences.getString("github_cached", null);
        boolean fresh = cached != null && (System.currentTimeMillis() - cachedAt) < GITHUB_CACHE_TTL_MS;

        if (fresh) {
            try {
                return parseGithubRelease(cached);
            } catch (Exception e) {
                Log.w(TAG, "Invalid cached GitHub release", e);
            }
        }

        try {
            String json = fetchText("https://api.github.com/repos/" + repo + "/releases/latest", 10000);
            JSObject parsed = parseGithubRelease(json);
            if (parsed != null) {
                preferences.edit()
                        .putString("github_cached", json)
                        .putLong("github_cached_at", System.currentTimeMillis())
                        .apply();
            }
            return parsed;
        } catch (Exception e) {
            if (cached != null) {
                Log.w(TAG, "GitHub request failed, using stale cache", e);
                return parseGithubRelease(cached);
            }
            throw e;
        }
    }

    // ------------------------------------------------------------- signatures

    private Set<String> signatureHashes(Signature[] signatures) throws Exception {
        Set<String> hashes = new HashSet<>();
        if (signatures == null) return hashes;
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        for (Signature signature : signatures) {
            if (signature == null) continue;
            hashes.add(Base64.encodeToString(digest.digest(signature.toByteArray()), Base64.NO_WRAP));
        }
        return hashes;
    }

    private Set<String> apkSignatureHashes(String path) {
        try {
            PackageManager manager = getContext().getPackageManager();
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo info = manager.getPackageArchiveInfo(path, PackageManager.GET_SIGNING_CERTIFICATES);
                if (info == null || info.signingInfo == null) return new HashSet<>();
                SigningInfo signingInfo = info.signingInfo;
                Signature[] signatures = signingInfo.hasMultipleSigners()
                        ? signingInfo.getApkContentsSigners()
                        : signingInfo.getSigningCertificateHistory();
                return signatureHashes(signatures);
            }
            @SuppressWarnings("deprecation")
            PackageInfo info = manager.getPackageArchiveInfo(path, PackageManager.GET_SIGNATURES);
            if (info == null) return new HashSet<>();
            @SuppressWarnings("deprecation")
            Signature[] signatures = info.signatures;
            return signatureHashes(signatures);
        } catch (Exception e) {
            Log.w(TAG, "Could not read APK signatures", e);
            return new HashSet<>();
        }
    }

    private Set<String> installedSignatureHashes() {
        try {
            PackageManager manager = getContext().getPackageManager();
            String packageName = getContext().getPackageName();
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo info = manager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES);
                if (info == null || info.signingInfo == null) return new HashSet<>();
                SigningInfo signingInfo = info.signingInfo;
                Signature[] signatures = signingInfo.hasMultipleSigners()
                        ? signingInfo.getApkContentsSigners()
                        : signingInfo.getSigningCertificateHistory();
                return signatureHashes(signatures);
            }
            @SuppressWarnings("deprecation")
            PackageInfo info = manager.getPackageInfo(packageName, PackageManager.GET_SIGNATURES);
            if (info == null) return new HashSet<>();
            @SuppressWarnings("deprecation")
            Signature[] signatures = info.signatures;
            return signatureHashes(signatures);
        } catch (Exception e) {
            Log.w(TAG, "Could not read installed signatures", e);
            return new HashSet<>();
        }
    }

    /**
     * Ensures the downloaded APK belongs to this app, is signed by the same
     * certificate and is actually newer than the installed version.
     */
    private String validateApk(File file, long expectedVersionCode) {
        PackageManager manager = getContext().getPackageManager();
        PackageInfo info = manager.getPackageArchiveInfo(file.getAbsolutePath(), 0);
        if (info == null) return "invalid_apk";

        if (!getContext().getPackageName().equals(info.packageName)) {
            return "package_mismatch";
        }

        Set<String> apkHashes = apkSignatureHashes(file.getAbsolutePath());
        Set<String> installedHashes = installedSignatureHashes();
        if (apkHashes.isEmpty() || installedHashes.isEmpty()) return "signature_unavailable";
        apkHashes.retainAll(installedHashes);
        if (apkHashes.isEmpty()) return "signature_mismatch";

        long apkVersionCode = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : (long) info.versionCode;
        long current = currentVersionCode(getContext());
        long target = expectedVersionCode > 0 ? expectedVersionCode : apkVersionCode;
        if (apkVersionCode <= current || target <= current) {
            return "not_newer";
        }
        return null;
    }

    private boolean installApk(File file) {
        try {
            Context context = getContext();
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            Activity activity = getActivity();
            if (activity != null) {
                activity.startActivity(intent);
            } else {
                context.startActivity(intent);
            }
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Could not launch installer", e);
            return false;
        }
    }

    private File updateFile() {
        File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) dir = getContext().getFilesDir();
        if (!dir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return new File(dir, PENDING_FILE_NAME);
    }

    // ------------------------------------------------------------ plugin API

    @PluginMethod
    public void getVersion(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("versionName", currentVersionName(context));
        result.put("versionCode", currentVersionCode(context));
        result.put("packageName", context.getPackageName());
        result.put("canInstallPackages", canRequestPackageInstalls());
        call.resolve(result);
    }

    @PluginMethod
    public void check(final PluginCall call) {
        final String manifestUrl = call.getString("manifestUrl", DEFAULT_MANIFEST_URL);
        final String repo = call.getString("githubRepo", DEFAULT_GITHUB_REPO);
        final Boolean allowGithubValue = call.getBoolean("allowGithub", true);
        final boolean allowGithub = allowGithubValue == null || allowGithubValue;

        getBridge().execute(new Runnable() {
            @Override
            public void run() {
                try {
                    JSObject best = null;

                    if (manifestUrl != null && !manifestUrl.isEmpty()) {
                        try {
                            best = checkManifest(manifestUrl);
                        } catch (Exception e) {
                            Log.w(TAG, "Manifest check failed: " + e.getMessage());
                        }
                    }

                    if (allowGithub && repo != null && !repo.isEmpty()) {
                        try {
                            JSObject fromGithub = checkGithub(repo);
                            if (fromGithub != null && (best == null
                                    || fromGithub.optLong("versionCode", 0) > best.optLong("versionCode", 0))) {
                                best = fromGithub;
                            }
                        } catch (Exception e) {
                            Log.w(TAG, "GitHub check failed: " + e.getMessage());
                        }
                    }

                    Context context = getContext();
                    long installedCode = currentVersionCode(context);
                    JSObject result = new JSObject();
                    result.put("currentVersionName", currentVersionName(context));
                    result.put("currentVersionCode", installedCode);
                    result.put("canInstallPackages", canRequestPackageInstalls());

                    boolean available = best != null && best.optLong("versionCode", 0) > installedCode;
                    result.put("available", available);
                    if (available) {
                        result.put("versionName", best.optString("versionName", ""));
                        result.put("versionCode", best.optLong("versionCode", 0));
                        result.put("url", best.optString("url", ""));
                        result.put("sha256", best.optString("sha256", ""));
                        result.put("notes", best.optString("notes", ""));
                        result.put("source", best.optString("source", ""));
                        result.put("size", best.optLong("size", 0));
                        result.put("assetName", best.optString("assetName", ""));
                        result.put("releaseUrl", best.optString("releaseUrl", ""));
                    }
                    call.resolve(result);
                } catch (Exception e) {
                    Log.e(TAG, "check failed", e);
                    call.reject("Update check failed: " + e.getMessage());
                }
            }
        });
    }

    @PluginMethod
    public void downloadAndInstall(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        if (downloading) {
            call.reject("A download is already in progress", "busy");
            return;
        }
        final String sha256 = call.getString("sha256", "");
        final String versionName = call.getString("versionName", "");
        final long versionCode = call.getData().optLong("versionCode", 0);

        downloading = true;
        JSObject result = new JSObject();
        result.put("status", "started");
        call.resolve(result);

        getBridge().execute(new Runnable() {
            @Override
            public void run() {
                try {
                    downloadApk(url, sha256, versionName, versionCode);
                } finally {
                    downloading = false;
                }
            }
        });
    }

    private void notifyEvent(final String event, final JSObject payload) {
        Activity activity = getActivity();
        if (activity == null) {
            notifyListeners(event, payload);
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                notifyListeners(event, payload);
            }
        });
    }

    private void downloadApk(String url, String expectedSha256, String versionName, long versionCode) {
        File target = updateFile();
        File partial = new File(target.getParentFile(), target.getName() + ".part");

        JSObject startEvent = new JSObject();
        startEvent.put("state", "started");
        startEvent.put("versionName", versionName);
        notifyEvent("progress", startEvent);

        long total = 0;
        try {
            HttpURLConnection connection = openConnection(url, "*/*", 15000);
            total = connection.getContentLengthLong();
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            InputStream input = connection.getInputStream();
            OutputStream output = new FileOutputStream(partial);
            byte[] buffer = new byte[64 * 1024];
            long downloaded = 0;
            long lastReport = 0;
            int read;
            while ((read = input.read(buffer)) > 0) {
                output.write(buffer, 0, read);
                digest.update(buffer, 0, read);
                downloaded += read;
                long now = System.currentTimeMillis();
                if (now - lastReport > 400) {
                    lastReport = now;
                    JSObject progress = new JSObject();
                    progress.put("state", "downloading");
                    progress.put("bytes", downloaded);
                    progress.put("total", total);
                    progress.put("percent", total > 0 ? (int) ((downloaded * 100L) / total) : -1);
                    notifyEvent("progress", progress);
                }
            }
            output.flush();
            output.close();
            input.close();
            connection.disconnect();

            String actualSha256 = hex(digest.digest());
            if (expectedSha256 != null && expectedSha256.length() > 0
                    && !expectedSha256.equalsIgnoreCase(actualSha256)) {
                //noinspection ResultOfMethodCallIgnored
                partial.delete();
                throw new IOException("Checksum mismatch (expected " + expectedSha256 + ", got " + actualSha256 + ")");
            }

            if (target.exists()) {
                //noinspection ResultOfMethodCallIgnored
                target.delete();
            }
            if (!partial.renameTo(target)) {
                //noinspection ResultOfMethodCallIgnored
                partial.delete();
                throw new IOException("Could not move downloaded APK into place");
            }

            String problem = validateApk(target, versionCode);
            if (problem != null) {
                //noinspection ResultOfMethodCallIgnored
                target.delete();
                throw new IOException("Rejected APK: " + problem);
            }

            prefs().edit()
                    .putString("pending_version_name", versionName == null ? "" : versionName)
                    .putLong("pending_version_code", versionCode)
                    .putString("pending_sha256", expectedSha256 == null ? "" : expectedSha256)
                    .putString("pending_path", target.getAbsolutePath())
                    .putBoolean("pending_install_started", false)
                    .apply();

            JSObject done = new JSObject();
            done.put("state", "downloaded");
            done.put("versionName", versionName == null ? "" : versionName);
            done.put("versionCode", versionCode);
            done.put("size", target.length());
            done.put("canInstallPackages", canRequestPackageInstalls());
            notifyEvent("progress", done);
        } catch (Exception e) {
            Log.e(TAG, "Download failed", e);
            //noinspection ResultOfMethodCallIgnored
            partial.delete();
            JSObject error = new JSObject();
            error.put("state", "error");
            error.put("message", e.getMessage() == null ? "download_failed" : e.getMessage());
            error.put("total", total);
            notifyEvent("progress", error);
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            builder.append(String.format(Locale.US, "%02x", value));
        }
        return builder.toString();
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        SharedPreferences preferences = prefs();
        String path = preferences.getString("pending_path", "");
        boolean available = path != null && path.length() > 0 && new File(path).exists();
        if (available && (preferences.getBoolean("pending_install_started", false)
                || preferences.getLong("pending_version_code", 0) <= currentVersionCode(getContext()))) {
            // Either the installer was already shown or the update is installed: the
            // pending APK is stale, so it is dropped instead of being offered again.
            discardPending();
            available = false;
        }
        JSObject result = new JSObject();
        result.put("available", available);
        if (available) {
            result.put("versionName", preferences.getString("pending_version_name", ""));
            result.put("versionCode", preferences.getLong("pending_version_code", 0));
            result.put("sha256", preferences.getString("pending_sha256", ""));
            result.put("path", path);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void installPending(PluginCall call) {
        SharedPreferences preferences = prefs();
        String path = preferences.getString("pending_path", "");
        if (path == null || path.isEmpty()) {
            call.reject("No pending update", "no_pending");
            return;
        }
        File file = new File(path);
        if (!file.exists()) {
            preferences.edit().remove("pending_path").apply();
            call.reject("Pending update file is gone", "no_pending");
            return;
        }
        if (!canRequestPackageInstalls()) {
            JSObject result = new JSObject();
            result.put("status", "permission");
            call.resolve(result);
            return;
        }
        String problem = validateApk(file, preferences.getLong("pending_version_code", 0));
        if ("not_newer".equals(problem)) {
            discardPending();
            JSObject result = new JSObject();
            result.put("status", "none");
            result.put("reason", problem);
            call.resolve(result);
            return;
        }
        if (problem != null) {
            JSObject result = new JSObject();
            result.put("status", "rejected");
            result.put("reason", problem);
            call.resolve(result);
            return;
        }
        boolean started = installApk(file);
        if (started) {
            preferences.edit().putBoolean("pending_install_started", true).apply();
        }
        JSObject result = new JSObject();
        result.put("status", started ? "started" : "failed");
        call.resolve(result);
    }

    @PluginMethod
    public void clearPending(PluginCall call) {
        discardPending();
        call.resolve();
    }

    private void discardPending() {
        SharedPreferences preferences = prefs();
        String path = preferences.getString("pending_path", "");
        if (path != null && !path.isEmpty()) {
            File file = new File(path);
            if (file.exists()) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        }
        preferences.edit()
                .remove("pending_path")
                .remove("pending_version_name")
                .remove("pending_version_code")
                .remove("pending_sha256")
                .remove("pending_install_started")
                .apply();
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Context context = getContext();
            if (Build.VERSION.SDK_INT >= 26) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + context.getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            } else {
                Intent intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Could not open install settings", e);
            call.reject("Could not open settings: " + e.getMessage());
        }
    }
}
