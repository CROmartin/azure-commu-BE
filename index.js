// ESM imports
import express from "express";
import { CommunicationIdentityClient } from "@azure/communication-identity";
import jsonfile from "jsonfile";
import jwt from "jsonwebtoken";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// File path for the JSON database
const dbFilePath = "db.json";

// Function to read database
async function readDb() {
  try {
    return await jsonfile.readFile(dbFilePath);
  } catch (error) {
    // If file doesn't exist, return default structure
    return { users: [] };
  }
}

// Function to write to database
async function writeDb(data) {
  await jsonfile.writeFile(dbFilePath, data, { spaces: 2 });
}

// Initialize Azure Communication Service client
const connectionString =
  "endpoint=https://azurecommunicationveljac.europe.communication.azure.com/;accesskey=eegkGxDNS4gHyFf46WitiTeaO1aHRooeVz95nbCgx7teLnCZ0RIdwCff+Az4EUtyh1Eo+FuC0cqQH6FlN1gmnQ==";
const identityClient = new CommunicationIdentityClient(connectionString);

// Endpoint to generate identity and token
app.post("/generate-token", async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).send("Name is required");
  }

  try {
    const dbData = await readDb();

    let user = dbData.users.find((u) => u.name === name);
    if (user) {
      // Decode the token to check expiration
      const decodedToken = jwt.decode(user.token);
      const currentTime = Math.floor(Date.now() / 1000);

      if (decodedToken && currentTime < decodedToken.exp) {
        // Token is still valid
        return res.json({ identity: user.identity, token: user.token });
      }

      // Token is expired, generate a new one
      const tokenResponse = await identityClient.getToken(
        { communicationUserId: user.identity },
        ["voip"]
      );
      user.token = tokenResponse.token;
      await writeDb(dbData);
    } else {
      // Create a new ACS user as user does not exist
      const newUser = await identityClient.createUser();
      const tokenResponse = await identityClient.getToken(newUser, ["voip"]);

      // Save the new user to the JSON database
      user = {
        name,
        identity: newUser.communicationUserId,
        token: tokenResponse.token,
      };
      dbData.users.push(user);
      await writeDb(dbData);
    }

    // Send response with user data
    res.json({ identity: user.identity, token: user.token });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("Error processing request");
  }
});

app.get("/all-users", async (req, res) => {
  try {
    const dbData = await readDb();
    res.json(dbData);
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).send("Error fetching data");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
