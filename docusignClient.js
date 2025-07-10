// docusignClient.js

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const axios = require("axios");

const DOCUSIGN_BASE_PATH = process.env.DOCUSIGN_BASE_PATH || "https://account-d.docusign.com";
const privateKey = process.env.DOCUSIGN_PRIVATE_KEY;

console.log("PRIVATE KEY RAW START");
console.log("🔐 DOCUSIGN_PRIVATE_KEY preview:", privateKey.slice(0, 30));  // ✅ Add this line

const JWT_LIFESPAN = 3600; // seconds

async function getAccessToken() {
  const jwtPayload = {
    iss: process.env.DOCUSIGN_INTEGRATION_KEY,
    sub: process.env.DOCUSIGN_USER_ID,
    aud: "account-d.docusign.com",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + JWT_LIFESPAN,
    scope: "signature impersonation",
  };

  const token = jwt.sign(jwtPayload, privateKey, {
    algorithm: "RS256",
    header: {
      kid: process.env.DOCUSIGN_RSA_KEYPAIR_ID,
    },
  });

  try {
    const qs = require("querystring");

    const response = await axios.post(`${DOCUSIGN_BASE_PATH}/oauth/token`, qs.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: token,
    }), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    return response.data.access_token;
  } catch (error) {
    console.error("DocuSign JWT Auth failed:");
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
      console.error("Headers:", error.response.headers);
    } else {
      console.error("Error message:", error.message);
    }
    throw new Error("Failed to authenticate with DocuSign");
  }

}

module.exports = {
  getAccessToken,
};
