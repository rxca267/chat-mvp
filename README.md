# Chat MVP

A simple real-time chat app with:
- User login and registration
- Group chat creation
- Message history
- Real-time messaging via Socket.IO
- Read receipts
- Basic web UI

## Run locally (recommended using Docker)

This project is containerized. To run locally with Docker Compose:

```bash
# build and start the app (app, postgres, redis if configured)
docker compose up --build
```

Open in browser:

```text
http://localhost:3000
```

If you prefer to run without Docker, the project will install dependencies and start when built by your platform (for example, Render). The Dockerfile and docker-compose.yml handle dependency installation and starting the service for you.

## Features

- Register and login with email + password
- Create group conversations
- Send text messages in real time
- View message history for each conversation
- Mark messages as read and see read counts
- Join conversations live without page refresh

## Environment variables

Copy `.env.example` and adjust values:

```bash
cp .env.example .env
```

Example:
```env
PORT=3000
JWT_SECRET=change_this_secret
```

## Run with Docker

```bash
docker compose up --build
```

Then open:
```text
http://localhost:3000
```

## Deploy to Render

Use the included `render.yaml` config.

1. Push this repo to GitHub.
2. Create a new Web Service on Render.
3. Connect the repository.
4. Render will use the config in `render.yaml` automatically.

## Notes

This is a lightweight MVP meant to be easy to run locally or deploy. The Docker setup installs dependencies and starts the service inside the container, so you don't need to run `npm install` or `npm start` manually when using Docker or a hosted platform that builds the project.
