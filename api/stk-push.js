export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed. Use POST.' });
  }

  try {
    let { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ success: false, error: 'Phone and amount are required.' });
    }

    // Format phone number to standard 254XXXXXXXXX
    phone = phone.trim().replace(/\+/g, '');
    if (phone.startsWith('0')) {
      phone = '254' + phone.substring(1);
    } else if (phone.startsWith('7') || phone.startsWith('1')) {
      phone = '254' + phone;
    }

    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const shortcode = process.env.MPESA_SHORTCODE || '174379';
    const passkey = process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
    const callbackUrl = process.env.MPESA_CALLBACK_URL || 'https://example.vercel.app/api/mpesa-callback';
    const env = process.env.MPESA_ENVIRONMENT || 'sandbox';

    if (!consumerKey || !consumerSecret) {
      return res.status(500).json({ success: false, error: 'M-Pesa API credentials missing in environment variables.' });
    }

    // 1. Get OAuth Access Token
    const authHeader = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const oauthUrl = env === 'production'
      ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
      : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

    const tokenRes = await fetch(oauthUrl, {
      headers: { 'Authorization': `Basic ${authHeader}` }
    });
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      return res.status(401).json({ success: false, error: tokenData.errorMessage || 'Failed to authenticate with Safaricom.' });
    }

    // 2. Generate Timestamp (EAT - UTC+3)
    const now = new Date();
    const eatOffset = 3 * 60;
    const eatTime = new Date(now.getTime() + (eatOffset + now.getTimezoneOffset()) * 60000);

    const year = eatTime.getFullYear();
    const month = String(eatTime.getMonth() + 1).padStart(2, '0');
    const day = String(eatTime.getDate()).padStart(2, '0');
    const hours = String(eatTime.getHours()).padStart(2, '0');
    const minutes = String(eatTime.getMinutes()).padStart(2, '0');
    const seconds = String(eatTime.getSeconds()).padStart(2, '0');
    const timestamp = `${year}${month}${day}${hours}${minutes}${seconds}`;

    // 3. Generate Password
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

    // 4. Send STK Push Request
    const stkUrl = env === 'production'
      ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
      : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

    const stkRes = await fetch(stkUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(Number(amount)),
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        CallBackURL: callbackUrl,
        AccountReference: 'O-BASE',
        TransactionDesc: 'Payment to O-BASE Portal'
      })
    });

    const stkData = await stkRes.json();

    if (stkRes.ok && (stkData.ResponseCode === '0' || stkData.ResponseCode === 0)) {
      return res.status(200).json({
        success: true,
        message: 'STK push sent! Check your phone for the M-Pesa PIN prompt.',
        checkoutRequestId: stkData.CheckoutRequestID
      });
    } else {
      return res.status(400).json({
        success: false,
        error: stkData.errorMessage || stkData.ResponseDescription || 'STK push failed.'
      });
    }

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
