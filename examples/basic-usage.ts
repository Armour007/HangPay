import { PopClient } from 'pop-pay';

/**
 * Basic usage of the pop-pay SDK to request a virtual card.
 * This script demonstrates how a browser agent might interact
 * with pop-pay to authorize a purchase.
 */
async function main() {
  // Initialize the client. Configuration is loaded from ~/.config/pop-pay/.env
  const client = new PopClient();

  console.log('Requesting authorization for AWS purchase...');

  try {
    // Request a virtual card for a specific vendor and amount.
    // The 'reasoning' field is analyzed by the guardrail engine.
    const result = await client.requestVirtualCard({
      amount: 15.00,
      vendor: 'AWS',
      reasoning: 'Need to provision a small EC2 instance for the web scraper project.'
    });

    if (result.approved) {
      console.log('✅ Payment Approved!');
      console.log(`Card Number: ${result.card.cardNumber}`); // e.g., ****-****-****-4242
      console.log(`Expiry: ${result.card.expiry}`);
      console.log(`CVV: ${result.card.cvv}`); // e.g., ***

      // The injection engine (if enabled) will automatically handle the CDP injection
      // once the agent is on the payment page.
    } else {
      console.log('❌ Payment Rejected.');
      console.log(`Reason: ${result.rejectionReason}`);
    }
  } catch (error) {
    console.error('Error during payment request:', error);
  }
}

main();
