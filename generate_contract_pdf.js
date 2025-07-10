require("dotenv").config();

const fs = require("fs");
const path = require("path");
const handlebars = require("handlebars");
const axios = require("axios");

async function generateContract(contractData) {
  const data = contractData; // ✅ Use request data

  // Load HTML template
  const templatePath = path.join(__dirname, "contract_template_minimal.html");
  const templateHtml = fs.readFileSync(templatePath, "utf8");

  // Compile with Handlebars
  const template = handlebars.compile(templateHtml);

  // Format and sort device data
  data.Devices_Table = data.Devices_Table
    .sort((a, b) => b.Volume - a.Volume)
    .map(device => ({
      ...device,
      Volume: device.Volume.toLocaleString(),
      Black_Bias: device.Black_Bias || "N/A",
      Cyan_Bias: device.Cyan_Bias || "N/A",
      Magenta_Bias: device.Magenta_Bias || "N/A",
      Yellow_Bias: device.Yellow_Bias || "N/A",
    }));

  const guardrails = [
    ["Fleet Output Avg. Mth. Lower Limit:", data.volumeLowerLimit],
    ["Fleet Output Avg. Mth. Upper Limit:", data.volumeUpperLimit],
    ["Device Lower Limit:", data.deviceLowerLimit],
    ["Device Upper Limit:", data.deviceUpperLimit],
  ];

  data.Guardrails_Table = guardrails
    .map(([label, value]) => `
      <tr>
        <td>${label}</td>
        <td>${value}</td>
      </tr>
    `)
    .join("");

  // Render HTML
  const html = template(data);

  // Generate PDF
  const response = await axios.post(
    "https://api.html2pdf.app/v1/generate",
    {
      html: html,
      apiKey: process.env.HTML2PDF_API_KEY,
    },
    { responseType: "arraybuffer" }
  );

  console.log("✅ PDF generated via html2pdf.app");
  return Buffer.from(response.data); // Return the PDF buffer
}

// ✅ Export the function
module.exports = { generateContract };
