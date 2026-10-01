# Chat MVP

A simple real-time chat app with:
- User login and registration
- Group chat creation
- Message history
- Real-time messaging via Socket.IO
- Read receipts
- Basic web UI

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the app:
   ```bash
   npm start
   ```

3. Open in browser:
   ```text
   http://localhost:3000
   ```

## Features

- Register and login with email + password
- Create group conversations
- Send text messages in real time
- View a message history for each conversation
- Mark messages as read and see read counts
- Join conversations live without page refresh

## Notes

This is a lightweight MVP meant to be easy to run locally. It stores data in JSON files under the `data/` directory, so no external database is required.
