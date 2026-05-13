export async function updateCustomerDisplayDuringPayment(
  total: number,
  paymentMethod: string,
  tip?: number
) {
  const baseUrl = process.env.HARDWARE_BRIDGE_SERVICE_URL;
  if (!baseUrl) {
    console.error('HARDWARE_BRIDGE_SERVICE_URL is not configured');
    return;
  }

  const url = `${baseUrl}/api/hardware/display/show`;
  const payload: Record<string, unknown> = {
    total,
    paymentMethod,
  };
  if (tip !== undefined) {
    payload.tip = tip;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(
        `Hardware Bridge Service error: ${response.status} ${response.statusText}`
      );
    }
  } catch (error) {
    console.error('Failed to update customer display:', error);
  }
}