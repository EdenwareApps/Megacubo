import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import os from 'os';

console.log('This script will build the Megacubo APKs for ARM and ARM64 architectures. You\'ll need to build the PC installers manually.');

// Get __dirname in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set JAVA_HOME if not already set (use Android Studio's JBR)
if (!process.env.JAVA_HOME) {
  const possibleJavaPaths = [
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    'C:\\Program Files\\Android\\Android Studio\\jre',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'android-studio', 'jbr') : '',
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Android', 'Android Studio', 'jbr') : '',
  ].filter(Boolean);
  
  for (const javaPath of possibleJavaPaths) {
    const javaExe = os.platform() === 'win32' 
      ? path.join(javaPath, 'bin', 'java.exe')
      : path.join(javaPath, 'bin', 'java');
    
    if (fs.existsSync(javaExe)) {
      process.env.JAVA_HOME = javaPath;
      console.log(`Using JAVA_HOME: ${javaPath}`);
      break;
    }
  }
}

// Ensure ANDROID_HOME / ANDROID_SDK_ROOT and add build-tools (with apksigner) to PATH
(() => {
  // Try to reuse existing SDK env vars first
  let androidSdkPath = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';

  const possibleAndroidPaths = [];

  // Try to read from android/local.properties first
  const localPropertiesPath = path.join(__dirname, "android", "local.properties");
  if (fs.existsSync(localPropertiesPath)) {
    const content = fs.readFileSync(localPropertiesPath, "utf-8");
    const sdkDirMatch = content.match(/sdk\.dir=(.+)/);
    if (sdkDirMatch) {
      // Unescape the path (convert C:\\\\ to C:\\)
      const sdkPath = sdkDirMatch[1].replace(/\\/g, path.sep);
      possibleAndroidPaths.push(sdkPath);
    }
  }

  // Add standard locations (including this machine's confirmed SDK path)
  possibleAndroidPaths.push(
    androidSdkPath,
    ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')] : []),
    ...(process.env.PROGRAMFILES ? [path.join(process.env.PROGRAMFILES, 'Android', 'Sdk')] : []),
    'C:\\Users\\Eden\\AppData\\Local\\Android\\Sdk'
  );

  // Remove duplicates and empty entries
  const uniquePaths = [...new Set(possibleAndroidPaths.filter(Boolean))];

  for (const candidatePath of uniquePaths) {
    const buildToolsDir = path.join(candidatePath, 'build-tools');
    if (!fs.existsSync(buildToolsDir)) {
      continue;
    }

    // Find the latest build-tools version
    const buildToolVersions = fs.readdirSync(buildToolsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
      .sort((a, b) => {
        // Sort versions numerically (36.1.0 > 35.0.0)
        const aParts = a.split('.').map(Number);
        const bParts = b.split('.').map(Number);
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          if ((bParts[i] || 0) !== (aParts[i] || 0)) {
            return (bParts[i] || 0) - (aParts[i] || 0);
          }
        }
        return 0;
      });

    if (buildToolVersions.length === 0) {
      continue;
    }

    const latestBuildTools = buildToolVersions[0];
    const buildToolsPath = path.join(buildToolsDir, latestBuildTools);

    // Prefer directory that actually contains apksigner
    const apksignerExecutable = os.platform() === 'win32'
      ? path.join(buildToolsPath, 'apksigner.bat')
      : path.join(buildToolsPath, 'apksigner');

    if (!fs.existsSync(apksignerExecutable)) {
      continue;
    }

    // Add build-tools (with apksigner) to PATH
    const buildToolsBin = os.platform() === 'win32' ? buildToolsPath : path.join(buildToolsPath, 'bin');
    process.env.PATH = `${buildToolsBin}${path.delimiter}${process.env.PATH}`;

    // Export SDK vars if they were not set
    if (!process.env.ANDROID_HOME) {
      process.env.ANDROID_HOME = candidatePath;
    }
    if (!process.env.ANDROID_SDK_ROOT) {
      process.env.ANDROID_SDK_ROOT = candidatePath;
    }

    console.log(`Using ANDROID_HOME: ${process.env.ANDROID_HOME}`);
    console.log(`Using build-tools: ${latestBuildTools}`);
    console.log(`Using apksigner from: ${apksignerExecutable}`);
    break;
  }
})();

// Check if DEBUG build is requested
const isDebug = process.env.DEBUG === 'true' || process.argv.includes('--debug');
const buildType = isDebug ? 'debug' : 'release';

// Constants
const RELEASE_DIRECTORY = path.join(__dirname, "releases");
const APK_OUTPUT_DIRECTORY = path.join(__dirname, "android", "app", "build", "outputs", "apk", buildType);
const BUILD_GRADLE_FILE_PATH = path.join(__dirname, "android", "app", "build.gradle");
const DISTRIBUTION_DIRECTORY = path.join(__dirname, "android", "app", "src", "main", "assets", "public", "nodejs", "dist");
const PACKAGE_JSON_PATH = path.join(__dirname, "package.json");
const SIGNING_PROPERTIES_PATH = path.join(__dirname, "release-signing.properties");

// Function to retrieve the application version from package.json
const getApplicationVersion = async () => {
  const version = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf-8")).version;
  return version || "";
};

// Function to read signing properties from the properties file
const readSigningProperties = () => {
  const properties = {};
  if (fs.existsSync(SIGNING_PROPERTIES_PATH)) {
    const content = fs.readFileSync(SIGNING_PROPERTIES_PATH, "utf-8").split("\n");
    content.forEach(line => {
      const [key, value] = line.split("=");
      if (key && value) {
        properties[key.trim()] = value.trim();
      }
    });
  }
  if(properties.storeFile && (properties.storeFile.startsWith(".") || !(properties.storeFile.includes("/") || properties.storeFile.includes("\\")))) {
    properties.storeFile = path.join(__dirname, properties.storeFile);
  }
  return properties;
};

// Update build.gradle file to include specified ABI
const updateBuildGradleWithABI = (abi) => {
  let gradleContent = fs.readFileSync(BUILD_GRADLE_FILE_PATH, "utf-8");
  if (Array.isArray(abi)) {
    abi = abi.join("', '");
  }
  gradleContent = gradleContent.replace(new RegExp(`include '[^\n]+'`), `include '${abi}'`);
  fs.writeFileSync(BUILD_GRADLE_FILE_PATH, gradleContent);
};

// Execute shell command with error handling
const executeCommand = (command) => {
  try {
    // Pass current environment including JAVA_HOME
    const env = process.env;
    execSync(command, { stdio: "inherit", env });
  } catch (error) {
    console.error(`Command failed: ${command}`);
    process.exit(error.status);
  }
};

// Copy bytenode (but not koffi) to Android distribution directory
const copyBytenodeToAndroid = () => {
  const sourceBytenodeDir = path.join(__dirname, "node_modules", "bytenode");
  const targetNodeModulesDir = path.join(DISTRIBUTION_DIRECTORY, "node_modules");
  const targetBytenodeDir = path.join(targetNodeModulesDir, "bytenode");

  if (!fs.existsSync(sourceBytenodeDir)) {
    console.warn(`Warning: bytenode source directory not found at ${sourceBytenodeDir}`);
    return;
  }

  console.log("Copying bytenode to Android distribution directory...");

  // Create node_modules directory if it doesn't exist
  if (!fs.existsSync(targetNodeModulesDir)) {
    fs.mkdirSync(targetNodeModulesDir, { recursive: true });
  }

  // Remove existing bytenode directory if it exists
  if (fs.existsSync(targetBytenodeDir)) {
    fs.rmSync(targetBytenodeDir, { recursive: true, force: true });
  }

  // Copy bytenode directory recursively
  const copyRecursiveSync = (src, dest) => {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    if (isDirectory) {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }
      fs.readdirSync(src).forEach(childItemName => {
        copyRecursiveSync(
          path.join(src, childItemName),
          path.join(dest, childItemName)
        );
      });
    } else {
      fs.copyFileSync(src, dest);
    }
  };

  copyRecursiveSync(sourceBytenodeDir, targetBytenodeDir);
  console.log(`Successfully copied bytenode to ${targetBytenodeDir}`);
};

// Main build process
const buildApplication = async () => {
  const applicationVersion = await getApplicationVersion();
  const signingProperties = readSigningProperties();

  if (!applicationVersion) {
    console.error('Application version is empty or undefined');
    process.exit(1);
  }
  
  // More flexible pattern for versions (accepts versions like 1.0, 1.0.0, 1.0.0-beta, etc.)
  const versionPattern = /^[0-9]+(\.[0-9]+)*(\-[a-zA-Z0-9\-\.]+)?$/;
  if (!versionPattern.test(applicationVersion)) {
    console.error(`Application version format is invalid: ${applicationVersion}`);
    console.error('Expected format: major.minor.patch[-prerelease] (e.g., 1.0.0, 1.0.0-beta)');
    process.exit(1);
  }

  console.log(`Application Version: ${applicationVersion}`);
  console.log(`Build Type: ${buildType.toUpperCase()}`);

  const signedApkPath = path.join(APK_OUTPUT_DIRECTORY, `app-${buildType}-signed.apk`);
  const unsignedApkPath = path.join(APK_OUTPUT_DIRECTORY, `app-${buildType}-unsigned.apk`);
  
  if (fs.existsSync(signedApkPath)) {
    fs.unlinkSync(signedApkPath);
  }
  
  if (fs.existsSync(unsignedApkPath)) {
    fs.unlinkSync(unsignedApkPath);
  }
  
  // ARM64 build process
  updateBuildGradleWithABI(["arm64-v8a", "armeabi-v7a"]);
  if (fs.existsSync(path.join(DISTRIBUTION_DIRECTORY, "premium.js"))) {
    fs.unlinkSync(path.join(DISTRIBUTION_DIRECTORY, "premium.js"));
  }

  for (const abi of ['arm64', 'arm']) {
    const premiumFilePath = path.join(__dirname, "premium_files", `premium-${abi}.jsc`);
    if (fs.existsSync(premiumFilePath)) {
      fs.copyFileSync(premiumFilePath, path.join(DISTRIBUTION_DIRECTORY, `premium-${abi}.jsc`));
    }
  }

  // Copy bytenode to Android distribution directory (Android needs only bytenode, not koffi)
  copyBytenodeToAndroid();

  // Build command
  let buildCommand;
  
  if (isDebug) {
    console.log("Building DEBUG APK (unsigned)...");
    // Use gradlew.bat on Windows, gradlew on Unix
    const gradlewCmd = os.platform() === 'win32' ? 'gradlew.bat' : './gradlew';
    buildCommand = `cd android && ${gradlewCmd} assembleDebug`;
  } else {
    buildCommand = `npx cap build android`;
    if (signingProperties.storeFile && signingProperties.storePassword && signingProperties.keyAlias && signingProperties.keyPassword) {
      console.log("Signing properties found. Signing APK...");
      buildCommand += ` --keystorepath ${signingProperties.storeFile} --keystorepass ${signingProperties.storePassword} --keystorealias ${signingProperties.keyAlias} --keystorealiaspass ${signingProperties.keyPassword}`;
    } else {
      console.log("Signing properties not found. Building unsigned APK...");
    }
    buildCommand += ` --androidreleasetype APK --signing-type apksigner`;
  }
  
  executeCommand(buildCommand);

  // For debug builds, the APK is in a different location with a different name
  let outputApkPath;
  if (isDebug) {
    // Debug APKs are named app-debug.apk and are located directly in the debug output directory
    const debugApkPath = path.join(APK_OUTPUT_DIRECTORY, "app-debug.apk");
    if (!fs.existsSync(debugApkPath)) {
      console.error(`Debug APK not found at: ${debugApkPath}`);
      process.exit(1);
    }
    outputApkPath = debugApkPath;
  } else {
    const signedApkMtime = fs.existsSync(signedApkPath) ? fs.statSync(signedApkPath).mtime : 0;
    const unsignedApkMtime = fs.existsSync(unsignedApkPath) ? fs.statSync(unsignedApkPath).mtime : 0;
    outputApkPath = signedApkMtime > unsignedApkMtime ? signedApkPath : unsignedApkPath;
  }
  
  // For debug builds, use a different naming convention
  const outputFileName = isDebug ? `Megacubo_${applicationVersion}_android-debug.apk` : `Megacubo_${applicationVersion}_android.apk`;
  fs.renameSync(outputApkPath, path.join(RELEASE_DIRECTORY, outputFileName));

  console.log(`Finished: ${new Date().toLocaleString()}`);
};

buildApplication().catch(error => console.error("Build failed:", error));