const path = require('path');
const fs = require('fs').promises;
const { pool } = require('@evershop/evershop/src/lib/postgres/connection');
const { getConfig } = require('@evershop/evershop/src/lib/util/getConfig');
const { Resend } = require('resend');
const { select } = require('@evershop/postgres-query-builder');
const { contries } = require('@evershop/evershop/src/lib/locale/countries');
const { provinces } = require('@evershop/evershop/src/lib/locale/provinces');
const { error, info } = require('@evershop/evershop/src/lib/log/logger');
const Handlebars = require('handlebars');
const { getEnv } = require('@evershop/evershop/src/lib/util/getEnv');
const { getValue } = require('@evershop/evershop/src/lib/util/registry');

module.exports = async function sendOrderConfirmationEmail(data) {
  try {
    const apiKey = getEnv('RESEND_API_KEY', '');
    const from = getConfig('resend.from', '');

    if (!apiKey || !from) {
      throw new Error('RESEND_API_KEY or resend.from is not configured properly.');
    }

    const resend = new Resend(apiKey);
    const orderPlaced = getConfig('resend.events.order_placed', {});

    if (!orderPlaced.enabled) {
      throw new Error('Order placed event is not enabled.');
    }

    const orderId = data.order_id;
    const order = await select().from('order').where('order_id', '=', orderId).load(pool);

    if (!order) {
      throw new Error(`Order with ID ${orderId} not found.`);
    }

    const emailData = order;
    emailData.items = await select().from('order_item').where('order_item_order_id', '=', order.order_id).execute(pool);

    emailData.shipping_address = await select().from('order_address').where('order_address_id', '=', order.shipping_address_id).load(pool);
    emailData.shipping_address.country_name = contries.find((c) => c.code === emailData.shipping_address.country)?.name || '';
    emailData.shipping_address.province_name = provinces.find((p) => p.code === emailData.shipping_address.province)?.name || '';

    emailData.billing_address = await select().from('order_address').where('order_address_id', '=', order.billing_address_id).load(pool);
    emailData.billing_address.country_name = contries.find((c) => c.code === emailData.billing_address.country)?.name || '';
    emailData.billing_address.province_name = provinces.find((p) => p.code === emailData.billing_address.province)?.name || '';

    const msg = {
      to: order.customer_email,
      subject: orderPlaced.subject || 'Order Confirmation',
      from
    };

    const emailDataFinal = await getValue('resend_order_confirmation_email_data', emailData, {});

    await resend.emails.send({
      to: 'azizkammoun47@gmail.com',
      subject: `New Order Placed: #${order.order_number}`,
      from,
      text: `
        A new order has been placed. Order details:
        Order ID: ${emailDataFinal.order_id}
        Order Date: ${emailDataFinal.created_at}
        Customer Email: ${emailDataFinal.customer_email}
        Order Number: ${emailDataFinal.order_number}
        Shipping to: ${emailDataFinal.shipping_address.full_name}

        Shipping Address:
        Shipping Address: ${emailDataFinal.shipping_address.address_1}
        Address City: ${emailDataFinal.shipping_address.city}
        Province Name: ${emailDataFinal.shipping_address.province_name}
        Country Name: ${emailDataFinal.shipping_address.country_name}
        Post Code: ${emailDataFinal.shipping_address.postcode}

        Order Items:
        ${emailDataFinal.items.map((item) => `- ${item.product_name} x ${item.qty} = ${item.final_price}`).join('\n')}
        
        Total Price:
        ${emailDataFinal.grand_total_text}
      `,
    });

    if (orderPlaced.templatePath) {
      const filePath = path.join(process.cwd(), orderPlaced.templatePath);
      const templateContent = await fs.readFile(filePath, 'utf8');
      msg.html = Handlebars.compile(templateContent)(emailDataFinal);
    } else {
      msg.text = `Your order #${order.order_number} has been placed. Thank you for shopping with us.`;
    }

    await resend.emails.send(msg);
    info(`Email sent successfully for order ID ${orderId}.`);

  } catch (e) {
    error(e);
  }
};
