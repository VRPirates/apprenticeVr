# Binary Dependencies

This directory contains external binary dependencies for different platforms that will be packaged with the application.

## Directory Structure

### Rclone
- `win32/rclone.exe` - Windows rclone binary
- `darwin/rclone` - macOS rclone binary
- `linux/rclone` - Linux rclone binary

### 7-Zip
- `win32/7z.exe` - Windows 7-Zip binary
- `darwin/7z` - macOS 7-Zip binary
- `linux/7z` - Linux 7-Zip binary

## How to Add Binaries

### Rclone
1. Download the appropriate rclone binary for each platform from the official website: https://rclone.org/downloads/
2. Place the binary in the corresponding directory:
   - Windows: `win32/rclone.exe`
   - macOS: `darwin/rclone`
   - Linux: `linux/rclone`
3. Make sure the binaries have the executable permission:
   ```bash
   chmod +x darwin/rclone
   chmod +x linux/rclone
   ```

### 7-Zip
1. Download the appropriate 7-Zip binary for each platform:
   - Windows: https://www.7-zip.org/download.html (get the standalone console version)
   - macOS: Install via brew (`brew install p7zip`) and copy to `darwin/7z`
   - Linux: Install via package manager and copy to `linux/7z`
2. Place the binary in the corresponding directory:
   - Windows: `win32/7z.exe`
   - macOS: `darwin/7z`
   - Linux: `linux/7z`
3. Make sure the binaries have the executable permission:
   ```bash
   chmod +x darwin/7z
   chmod +x linux/7z
   ```

The build process will automatically include these binaries in the application package and make them available to the application at runtime.

## Building for Development

For development purposes, make sure you have rclone and 7z installed on your system and available in your PATH. The application will use the system's binaries when running in development mode.

## License

Please respect the license terms when distributing these binaries with your application. 