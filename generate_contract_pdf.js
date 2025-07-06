require('dotenv').config(); // Load environment variables

const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');

async function generatePDF() {
  // Load HTML template
  const templatePath = path.join(__dirname, 'contract_template_minimal.html');
  const templateHtml = fs.readFileSync(templatePath, 'utf8');

  // Compile with Handlebars
  const template = handlebars.compile(templateHtml);

const data = require('./contract_data.json');

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
`).join('');

  // Inject data
  const html = template(data);

const axios = require('axios');

// Send HTML to html2pdf.app and save PDF
const response = await axios.post(
  'https://api.html2pdf.app/v1/generate',
  {
    html: html,
    apiKey: process.env.HTML2PDF_API_KEY,
  },
  { responseType: 'arraybuffer' }
);

// Save PDF to file
fs.writeFileSync('Subscription_Contract.pdf', response.data);
console.log('✅ PDF generated via html2pdf.app: Subscription_Contract.pdf');

}

generatePDF().catch(console.error);
