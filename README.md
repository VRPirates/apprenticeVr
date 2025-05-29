# ApprenticeVR

ApprenticeVR is a modern, cross-platform desktop application built with Electron, React, and TypeScript, designed for managing and sideloading content onto Meta Quest devices. It aims to provide a user-friendly and feature-rich alternative to existing sideloading tools.

## Inspiration

This project is heavily inspired by the fantastic work done on [Rookie Sideloader](https://github.com/VRPirates/rookie). ApprenticeVR seeks to build upon that foundation by offering a contemporary interface and experience across Windows, macOS, and Linux.

## Features

*   **Cross-Platform:** Works seamlessly on Windows, macOS, and Linux.
*   **Modern User Interface:** Built with Fluent UI and React for a clean and responsive experience.
*   **Device Management:**
    *   Automatically detect and list connected Meta Quest devices.
    *   Connect to and disconnect from devices.
    *   View device details such as model, ID, battery level, and storage information.
    *   Handles unauthorized and offline device states.
*   **Game Library Management:**
    *   Browse a comprehensive list of available games and applications.
    *   View game details including thumbnails, descriptions, versions, popularity, size, and last update date.
    *   Search and filter games by name, package ID, installation status, or available updates.
*   **Installation & Sideloading:**
    *   Download game files and OBBs.
    *   Install, uninstall, and update applications on your Quest device.
    *   Reinstall existing applications.
    *   Handle updates for installed applications.
*   **Download Management:**
    *   View and manage a queue of ongoing and completed downloads.
    *   Track download progress, extraction progress, and installation status.
    *   Cancel, retry, and delete downloaded files.
*   **Automatic Dependency Handling:** Manages required tools like ADB and rclone.
*   **Light & Dark Mode:** Adapts to your system's preferred theme.

## Screenshots

Here are some glimpses of ApprenticeVR in action:

**Device List (Dark Mode)**
![Device List - Dark Mode](screenshots/01_devices_dark.png)

**Game Library (Light Mode)**
![Game Library - Light Mode](screenshots/02_library_light.png)

**Game Details (Light Mode)**
![Game Details - Light Mode](screenshots/03_detail_light.png)

**Downloads Manager (Dark Mode)**
![Downloads Manager - Dark Mode](screenshots/04_download_dark.png)

### macOS Specifics

**Important:** Since the application is not signed by an Apple Developer ID, when you first try to open `apprenticevr.app` on macOS after building or downloading it, you might encounter an error message stating: `"apprenticeVR is damaged and can't be opened. You should move it to the Trash."`

This error occurs because macOS Gatekeeper flags applications downloaded from the internet or built by unidentified developers as potentially unsafe. The `com.apple.quarantine` extended attribute is added to the application bundle by the system.

To resolve this, you can remove this extended attribute by running the following command in your Terminal:

```bash
xattr -c /Applications/apprenticevr.app
```

**Note:**
*   You might need to adjust the path `/Applications/apprenticevr.app` if you have placed the application in a different location.
*   The `-c` flag in the `xattr` command stands for "clear," and it removes all extended attributes from the specified file or application bundle. By removing the quarantine attribute, you are essentially telling macOS that you trust this application.

After running this command, you should be able to open ApprenticeVR without any issues.

## Logs

By default, it writes logs to the following locations:

 - **on Linux:** `~/.config/apprenticevr/logs/main.log`
 - **on macOS:** `~/Library/Logs/apprenticevr/main.log`
 - **on Windows:** `%USERPROFILE%\AppData\Roaming\apprenticevr\logs\main.log`

**Note:** When opening an issue, please include the latest log output from the appropriate log file above to help with debugging and troubleshooting.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Prerequisites

*   [Node.js](https://nodejs.org/) (which includes npm)
*   [pnpm](https://pnpm.io/installation) (Recommended package manager)

### Install Dependencies

```bash
pnpm install
```

## Development

To run the application in development mode with hot-reloading:

```bash
pnpm dev
```

This will start the Electron application and open a development server for the React frontend.

## Building the Application

You can build the application for different platforms using the following commands:

```bash
# For Windows
pnpm build:win

# For macOS
pnpm build:mac

# For Linux
pnpm build:linux
```

Builds will be located in the `dist` or a platform-specific output directory.

## Linting and Formatting

To lint the codebase:
```bash
pnpm lint
```

To format the codebase with Prettier:
```bash
pnpm format
```

To perform type checking:
```bash
pnpm typecheck
```


---
![](https://badges.pufler.dev/visits/jimzrt/apprenticeVr)
