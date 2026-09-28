const nodemailer = require('../backend/node_modules/nodemailer');

const sender = process.argv[2];
if (sender !== 'buva.fragrance@gmail.com') {
  console.error('Unexpected sender address.');
  process.exit(1);
}

const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', async () => {
  const password = Buffer.concat(chunks).toString('utf8');
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: sender, pass: password },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 15000
    });
    await transporter.verify();
    console.log('Gmail authentication succeeded.');
  } catch (error) {
    console.error(`Gmail authentication failed: ${error.code || error.message}`);
    process.exitCode = 1;
  }
});
