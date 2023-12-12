// ESM imports
import express from "express";
import { CommunicationIdentityClient } from "@azure/communication-identity";
import {
  PublicClientApplication,
  ConfidentialClientApplication,
  CryptoProvider,
} from "@azure/msal-node";
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
  "endpoint=https://azure-communication-martin.europe.communication.azure.com/;accesskey=BH6HhYAkJlrND5H5mmWbpnKVIp8/iM6HTcyFeDPTLC+nFw0XzcGAJ01/EL3z7jNZ/kKL5tbkTyXT+7TvinFX6w==";
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

app.get("/teams-token", async (req, res) => {
  try {
    // Read the current data from the database
    let dbData = await readDb();

    if (dbData.teamsUsers && dbData.teamsUsers.length > 0) {
      // Get the first user's data
      let firstUser = dbData.teamsUsers[0];

      // Send the user data
      res.status(200).json(firstUser);
    } else {
      // If no users are found in the database
      res.status(404).send("No teams user found in the database.");
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("Internal Server Error");
  }
});

const PORT = process.env.PORT || 3000;

const REDIRECT_URI = `http://localhost:${PORT}/redirect`;
const clientId = "71ec184c-069c-43e1-a7d0-8994917f98ab";
const tenantId = "1bfd6abf-6ad6-4190-b64a-626e85072fd7";

// Create configuration object that will be passed to MSAL instance on creation.
const msalConfig = {
  auth: {
    clientId: clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    clientSecret: "T3P8Q~0QYktwxsvHo7YU2uazqTqq9Ig1jx~0Aak8",
  },
};

// Create an instance of PublicClientApplication
const pca = new ConfidentialClientApplication(msalConfig);
const provider = new CryptoProvider();

let pkceVerifier = "";
const scopes = [
  "https://auth.msft.communication.azure.com/Teams.ManageCalls",
  "https://auth.msft.communication.azure.com/Teams.ManageChats",
];

app.get("/", async (req, res) => {
  // Generate PKCE Codes before starting the authorization flow
  const { verifier, challenge } = await provider.generatePkceCodes();
  pkceVerifier = verifier;

  const authCodeUrlParameters = {
    scopes: scopes,
    redirectUri: REDIRECT_URI,
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
  };
  // Get url to sign user in and consent to scopes needed for application
  pca
    .getAuthCodeUrl(authCodeUrlParameters)
    .then((response) => {
      res.redirect(response);
    })
    .catch((error) => console.log(JSON.stringify(error)));

  // res.sendStatus(200).send("Hello World");
});

app.get("/redirect", async (req, res) => {
  // Create request parameters object for acquiring the AAD token and object ID of a Teams user
  const tokenRequest = {
    code: req.query.code,
    scopes: scopes,
    redirectUri: REDIRECT_URI,
    codeVerifier: pkceVerifier,
  };
  // Retrieve the AAD token and object ID of a Teams user
  pca
    .acquireTokenByCode(tokenRequest)
    .then(async (response) => {
      let teamsUserAadToken = response.accessToken;
      let userObjectId = response.uniqueId;

      let accessToken = await identityClient.getTokenForTeamsUser({
        teamsUserAadToken: teamsUserAadToken,
        clientId: clientId,
        userObjectId: userObjectId,
      });

      let dbData = await readDb();

      // Add the new accessToken to the database
      dbData.teamsUsers.unshift({ userObjectId, ...accessToken });

      // Write the updated data back to the database
      await writeDb(dbData);

      //TODO: the following code snippets go here
      res.status(200).json({ teamsUserAadToken, userObjectId, accessToken });
    })
    .catch((error) => {
      console.log(error);
      res.status(500).send(error);
    });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
