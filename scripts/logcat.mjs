import { spawn, execSync } from 'node:child_process'

// Improved generic command execution with proper line buffering
const execCommand = (command, lineProcessor = null) => {
  console.log('Command: ', command)
  const [cmd, ...args] = command.split(' ')
  const proc = spawn(cmd, args, { encoding: 'utf8' })

  // Buffer to accumulate chunks that may be split across line boundaries
  let buffer = ''

  proc.stdout.on('data', (chunk) => {
    buffer += chunk
    let lines = buffer.split('\n')

    // Last part may be incomplete → keep it for next chunk
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (lineProcessor) {
        const processed = lineProcessor(line + '\n') // add \n back
        if (processed !== null) { // null = discard the line
          process.stdout.write(processed)
        }
      } else {
        process.stdout.write(line + '\n')
      }
    }
  })

  // When process ends, process remaining buffer
  proc.stdout.on('end', () => {
    if (buffer.trim()) {
      if (lineProcessor) {
        const processed = lineProcessor(buffer + '\n')
        if (processed !== null) process.stdout.write(processed)
      } else {
        process.stdout.write(buffer + '\n')
      }
    }
  })

  proc.stderr.on('data', (data) => {
    process.stderr.write('Erro: ' + data)
  })

  proc.on('close', (code) => {
    console.log(code === 0 ? 'Command completed successfully' : `Command ended with code ${code}`)
  })

  proc.on('error', (err) => {
    console.error('Erro ao iniciar processo:', err.message)
  })
}

// App package name - adjust if needed
const APP_PACKAGE = 'tv.megacubo.app'

// Logcat-specific filter (only for coloring - filtering is done by PID)
const red = '\x1b[31m'
const green = '\x1b[32m'
const reset = '\x1b[0m'

// Create a filter function that colors logs and optionally filters by PID
const createLogFilter = (targetPid = null) => {
  return (fullLine) => {
    const line = fullLine.trimEnd() // remove \n at end if present
    if (!line) return line + '\n' // keep empty lines

    // If PID filtering is needed (fallback for older Android versions)
    if (targetPid) {
      // Logcat format: MM-DD HH:MM:SS.mmm PID TID TAG: message
      // Or: HH:MM:SS.mmm PID TID LEVEL/TAG: message
      // PID is typically the first numeric field after the timestamp
      // Timestamp ends with .mmm (milliseconds), then comes PID
      const match = line.match(/\.\d{3}\s+(\d+)\s+\d+/)
      if (match) {
        const linePid = match[1]
        if (linePid !== targetPid) {
          return null // Discard lines from other processes
        }
      } else {
        // Fallback: if format doesn't match, try splitting by spaces
        // PID is usually 3rd or 4th field (after date/time)
        const parts = line.split(/\s+/)
        if (parts.length >= 4) {
          // Try positions 2, 3, 4 (0-indexed: 2, 3, 4)
          const possiblePids = [parts[2], parts[3], parts[4]].filter(p => /^\d+$/.test(p))
          if (possiblePids.length > 0 && possiblePids[0] !== targetPid) {
            return null
          }
        }
      }
    }

    const lower = line.toLowerCase()
    
    // Color according to error or not (all lines are already from our app via PID filter)
    if (lower.includes('error') || lower.includes('exception') || lower.includes('crash') || lower.includes('fatal')) {
      return red + line + reset + '\n'
    } else {
      return green + line + reset + '\n'
    }
  }
}

// Main execution
try {
  const adbDevicesOutput = execSync('adb devices', { encoding: 'utf8' })
  const deviceList = adbDevicesOutput
    .split('\n')
    .filter(line => line.trim() && /device\s*$/.test(line))
    .map(line => line.split(/\s+/)[0].split('\t')[0])
    .filter(device => device && device !== 'List')

  const device = deviceList[0]

  if (!device) {
    console.error('Nenhum dispositivo/emulador encontrado')
    process.exit(1)
  }

  const finalDevice = device.startsWith('emulator-')
    ? `127.0.0.1:${device.split('-')[1]}`
    : device

  console.log(`Dispositivo encontrado: ${finalDevice}`)

  // Connect (no filter, just to see if it worked)
  execCommand(`adb connect ${finalDevice}`)

  // Get app PID (Process ID) for filtering
  console.log(`Buscando PID do app ${APP_PACKAGE}...`)
  let appPid
  try {
    const pidOutput = execSync(`adb -s ${finalDevice} shell pidof -s ${APP_PACKAGE}`, { encoding: 'utf8' }).trim()
    appPid = pidOutput
    if (!appPid || isNaN(parseInt(appPid))) {
      throw new Error('PID not found')
    }
    console.log(`App encontrado! PID: ${appPid}`)
  } catch (err) {
    console.error(`Error: App ${APP_PACKAGE} is not running or was not found`)
    console.error('Make sure the app is open on the device')
    process.exit(1)
  }

  // Logcat filtered by PID - most efficient and accurate method!
  // This shows ONLY logs from your app's process, regardless of tag
  // Note: --pid requires Android 7.0+ (API 24). For older versions, we use fallback filtering
  console.log(`Iniciando logcat filtrado por PID ${appPid}...`)
  
  // Try --pid first (Android 7.0+), fallback to Node.js filtering for older versions
  const logFilter = createLogFilter(appPid) // Fallback: filter by PID in Node.js if --pid fails
  execCommand(`adb -s ${finalDevice} logcat --pid=${appPid}`, logFilter)
  
  // If --pid is not supported, uncomment this line and comment the one above:
  // execCommand(`adb -s ${finalDevice} logcat`, logFilter) // Fallback: filters by PID in Node.js

} catch (err) {
  console.error('Erro com adb:', err.message)
  process.exit(1)
}
