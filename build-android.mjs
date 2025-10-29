import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

console.log('This script will build the Megacubo APKs for ARM and ARM64 architectures, building PC installers is not covered yet. Remember to run \'npm run prepare\' before running this script.');

// Get __dirname in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Constants
const RELEASE_DIRECTORY = path.join(__dirname, "releases");
const APK_OUTPUT_DIRECTORY = path.join(__dirname, "android", "app", "build", "outputs", "apk", "release");
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
    execSync(command, { stdio: "inherit" });
  } catch (error) {
    console.error(`Command failed: ${command}`);
    process.exit(error.status);
  }
};

// Main build process
const buildApplication = async () => {
  const applicationVersion = await getApplicationVersion();
  const signingProperties = readSigningProperties();

  if (!applicationVersion) {
    console.error('Application version is empty or undefined');
    process.exit(1);
  }
  
  // Padrão mais flexível para versões (aceita versões como 1.0, 1.0.0, 1.0.0-beta, etc.)
  const versionPattern = /^[0-9]+(\.[0-9]+)*(\-[a-zA-Z0-9\-\.]+)?$/;
  if (!versionPattern.test(applicationVersion)) {
    console.error(`Application version format is invalid: ${applicationVersion}`);
    console.error('Expected format: major.minor.patch[-prerelease] (e.g., 1.0.0, 1.0.0-beta)');
    process.exit(1);
  }

  console.log(`Application Version: ${applicationVersion}`);

  const signedApkPath = path.join(APK_OUTPUT_DIRECTORY, "app-release-signed.apk");
  const unsignedApkPath = path.join(APK_OUTPUT_DIRECTORY, "app-release-unsigned.apk");
  
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

  // Build command
  let buildCommand = `npx cap build android`;

  if (signingProperties.storeFile && signingProperties.storePassword && signingProperties.keyAlias && signingProperties.keyPassword) {
    console.log("Signing properties found. Signing APK...");
    buildCommand += ` --keystorepath ${signingProperties.storeFile} --keystorepass ${signingProperties.storePassword} --keystorealias ${signingProperties.keyAlias} --keystorealiaspass ${signingProperties.keyPassword}`;
  } else {
    console.log("Signing properties not found. Building unsigned APK...");
}

  buildCommand += ` --androidreleasetype APK --signing-type apksigner`;
  executeCommand(buildCommand);

  const signedApkMtime = fs.existsSync(signedApkPath) ? fs.statSync(signedApkPath).mtime : 0;
  const unsignedApkMtime = fs.existsSync(unsignedApkPath) ? fs.statSync(unsignedApkPath).mtime : 0;
  
  const outputApkPath = signedApkMtime > unsignedApkMtime ? signedApkPath : unsignedApkPath;
  fs.renameSync(outputApkPath, path.join(RELEASE_DIRECTORY, `Megacubo_${applicationVersion}_android.apk`));

  console.log(`Finished: ${new Date().toLocaleString()}`);
};

buildApplication().catch(error => console.error("Build failed:", error));