# Nu7 Avatar BLE & Studio

Nu7 Avatar BLE & Studio is a comprehensive platform for AI-integrated yoga sessions, featuring interactive 3D avatars controlled via BLE (Bluetooth Low Energy) and real-time posture analysis.

## 🚀 Getting Started

Follow these steps to set up and run the project on your local machine.

### Prerequisites

Ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [NPM](https://www.npmjs.com/)
- [Docker](https://www.docker.com/) (for the PostgreSQL database)
- [Git](https://git-scm.com/)

### 🛠️ Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd exp_avatar_with_studio
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in the root directory and add the following:
   ```env
   DATABASE_URL="postgresql://postgres:password@localhost:5432/nu7_avatar_db?schema=public"
   JWT_SECRET="your_secure_jwt_secret"
   PORT=3001
   VITE_AI_HOST=localhost
   VITE_AI_PORT=8000
   ```

---

## 🏃 Running the Program

The easiest way to run the entire stack (Database, Backend, and Frontend) is using the main dev script.

### 1. Run Everything (Full Stack)
This command automatically starts the database container, applies Prisma migrations, and launches both backend and frontend servers.
```bash
npm run dev
```

### 2. Mode-Specific Execution
You can specify a display mode for the studio using the `-o` flag:
```bash
npm run dev -- -o 2
```
*(Default mode is `1` if not specified)*

### 3. Individual Commands
If you need more control, you can run components separately:

*   **Start Database (Docker):** `npm run db:up`
*   **Apply DB Migrations:** `npm run db:push`
*   **Run Backend Only:** `npm run dev:backend`
*   **Run Frontend Only:** `npm run dev:frontend`

---

## 📂 Project Structure

- `server.js`: Express backend handling authentication, sessions, and AI integration.
- `main.js`: Core frontend logic for 3D avatar rendering and BLE communication.
- `prisma/`: Database schema and client configuration.
- `docker-compose.yml`: PostgreSQL database configuration.
- `dev.js`: Orchestration script for the development environment.
- `style.css`: Modern, premium UI styling.

## 🧪 AI & Voice Features

The project includes advanced AI integration for a seamless yoga experience:

### 🎙️ Unified Voice Intents
Control your session hands-free using natural language. Recognition matches are fuzzy, so variations of these phrases will work:
- **"End Session"**: Saves your progress and returns to the dashboard.
- **"Reset Pose" / "Calibrate"**: Resets your 3D avatar posture (T-Pose).
- **"Calibrate and Start Session"**: Performs a quick calibration and immediately begins the AI session.
- **"Mute/Unmute Mic"**: Toggles your voice stream during an active session.

### 🔊 Speech-to-Speech (S2S) Pipeline
- **Real-time Pipeline**: Audio is streamed via WebSockets to a dedicated Python backend for STT -> LLM -> TTS.
- **High Accuracy**: Input audio is boosted by 2.0x for superior transcription in noisy environments.
- **Smart Interruption**: Local voice commands automatically suppress AI chatter for immediate feedback.

### 🧍 Pose Comparison
- Real-time **bone-to-bone comparison** between the User and Trainer avatars to guide your practice.

---

## 📦 Repository & Assets
To keep the code lightweight and faster to clone, large 3D assets (`.glb` files) are excluded from the Git repository.

- **Infrastructure**: All project logic, shaders, and UI are in the repo.
- **Large Assets**: `.glb` and `.bin` models must be provided/managed locally in the `public/avatar/` directory.

---
© 2026 Nu7 Studio. All rights reserved.
