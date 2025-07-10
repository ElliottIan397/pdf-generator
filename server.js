const express = require("express");
const app = express(); // ✅ app must be declared before it's used

// ✅ Custom CORS middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const handlebars = require("handlebars");
const axios = require("axios");

const PORT = process.env.PORT || 3000;

// did not work
// app.use(cors({
//  origin: "*",
//  methods: ["POST", "OPTIONS"],
//  allowedHeaders: ["Content-Type"]
//}));

app.use(bodyParser.json({ limit: "2mb" }));

app.post("/generate-pdf", async (req, res) => {
  try {
    // Load and compile HTML template
    const templatePath = path.join(__dirname, "contract_template_minimal.html");
    const templateHtml = fs.readFileSync(templatePath, "utf8");
    const template = handlebars.compile(templateHtml);

    // Guardrail table formatting
    const data = req.body;
    const guardrails = [
      ["Fleet Output Avg. Mth. Lower Limit:", data.volumeLowerLimit],
      ["Fleet Output Avg. Mth. Upper Limit:", data.volumeUpperLimit],
      ["Device Lower Limit:", data.deviceLowerLimit],
      ["Device Upper Limit:", data.deviceUpperLimit],
    ];

    data.Guardrails_Table = guardrails.map(([label, value]) => `
      <tr>
        <td>${label}</td>
        <td>${value}</td>
      </tr>
    `).join("");

    // Generate HTML from data
    const html = template(data);

    // Send to html2pdf.app
    const response = await axios.post(
      "https://api.html2pdf.app/v1/generate",
      {
        html: html,
        apiKey: process.env.HTML2PDF_API_KEY,
      },
      { responseType: "arraybuffer" }
    );

    // Return PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=contract.pdf");
    res.send(response.data);
  } catch (err) {
    console.error("DocuSign send error:", {
      message: err.message,
      response: err.response?.data,
      stack: err.stack
    });
    res.status(500).send("Failed to send to DocuSign");
  }
});

const { generateContract } = require("./generate_contract_pdf");
const { getAccessToken } = require("./docusignClient");

app.post("/send-envelope", async (req, res) => {
  const contractData = req.body.contractData || req.body;

  if (!contractData.Customer_Email) {
    return res.status(400).json({ error: "Missing Customer_Email." });
  }

  try {
    const accessToken = await getAccessToken();

    // Generate contract PDF
    const pdfBuffer = await generateContract(contractData);

    const envelopeDefinition = {
      emailSubject: "Please sign your Subscription Agreement",
      documents: [
        {
          documentBase64: pdfBuffer.toString("base64"),
          name: "Subscription_Agreement.pdf",
          fileExtension: "pdf",
          documentId: "1",
        },
      ],
      recipients: {
        signers: [
          {
            email: contractData.Customer_Email,
            name: contractData.Customer_Contact || "Customer",
            recipientId: "1",
            routingOrder: "1",
            tabs: {
              signHereTabs: [
                {
                  anchorString: "/sign_here/",
                  anchorUnits: "pixels",
                  anchorYOffset: "10",
                  anchorXOffset: "20",
                },
              ],
            },
          },
        ],
      },
      status: "sent",
    };

    const response = await axios.post(
      `${process.env.DOCUSIGN_BASE_PATH}/restapi/v2.1/accounts/${process.env.DOCUSIGN_ACCOUNT_ID}/envelopes`,
      envelopeDefinition,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).json({ envelopeId: response.data.envelopeId });

  } catch (err) {
    console.error("DocuSign send error:", err.response?.data || err.message);
    res.status(500).send("Failed to send to DocuSign");
  }
});
app.listen(PORT, () => {
  console.log(`PDF service running on port ${PORT}`);
});
