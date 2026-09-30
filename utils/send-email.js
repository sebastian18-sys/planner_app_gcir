const nodemailer = require('nodemailer');

let transporter = null;

function escapeHtml(v = "") {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


module.exports = {
    sendEmail: async function (
        priority = 'high',
        from,
        to,
        cc,
        subject,
        html,
        attachments) {
        if (!transporter) {
            transporter = nodemailer.createTransport(
                {
                    // host: '10.68.143.121',
                    host: '10.66.250.230',
                    port: 25,
                    secure: false,
                    tls:
                        {
                            ciphers: 'SSLv3'
                        }
                }
            )
        }
        return new Promise((resolve, reject) => {
                transporter.sendMail(
                    {
                        priority,
                        from,
                        to,
                        cc,
                        subject,
                        html,
                        attachments
                    },
                    (err, data) => {
                        if (err)
                            return reject(err);
                        console.log(err);
                        transporter.close();
                        resolve(data);
                    }
                )
            }
        )
    },

    generateInfoHTML: function ({ title, message }) {
        return `
            <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
            <html xmlns="http://www.w3.org/1999/xhtml">
            <head>
                <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
                <title>PLANNER NOTIFIER</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
            </head>
            <body style="margin: 0; padding: 0;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                        <td style="padding: 0px 0 0px 0;">
                            <table align="center" border="0" cellpadding="0" cellspacing="0" width="600">
                                <tr>
                                    <td bgcolor="#ffffff" style="padding: 40px 30px 40px 30px;">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr>
                                                <td style="color: #153643; font-family: Arial, sans-serif; font-size: 19px;">
                                                    ${title}
                                                </td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 25px 0 30px 0; color: #153643; font-family: Arial, sans-serif; font-size: 16px; line-height: 20px;">
                                                    ${message}
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                <tr></tr>
                                <tr>
                                    <td bgcolor="#224b99" style="padding: 30px 30px 30px 30px;">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr>
                                                <td style="color: #ffffff; font-family: Arial, sans-serif; font-size: 14px; text-align: center" width="75%">
                                                    © Gerencia de Construcción e Infraestructura de Red 2024<br/>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
        `;
    },

    generateSncHtml: function ({ title, message }) {
        return `
        <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
        <html xmlns="http://www.w3.org/1999/xhtml">
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
            <title>PLANNER NOTIFIER</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        </head>
        <body style="margin: 0; padding: 0;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                    <td style="padding: 0px 0 0px 0;">
                        <table align="center" border="0" cellpadding="0" cellspacing="0" width="600">
                            <tr>
                                <td bgcolor="#ffffff" style="padding: 40px 30px 40px 30px;">
                                    <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                        <tr>
                                            <td style="color: #153643; font-family: Arial, sans-serif; font-size: 19px;">
                                                ${title}
                                            </td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 25px 0 30px 0; color: #153643; font-family: Arial, sans-serif; font-size: 16px; line-height: 20px;">
                                                ${message}
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                            <tr></tr>
                            <tr>
                                <td style="background-color: #221e78; text-align: center;">
                                    <img src="cid:footer"/>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
        `;
    },

    generateHtmlConfirm: function ({ userMid, username }) {
        return `
        <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
        <html xmlns="http://www.w3.org/1999/xhtml">
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
            <title>Demystifying Email Design</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        </head>
        <body style="margin: 0; padding: 0;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
                <td style="padding: 10px 0 30px 0;">
                    <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="border: 1px solid #cccccc; border-collapse: collapse;">
                        <tr>
                            <td bgcolor="#ffffff" style="padding: 40px 30px 40px 30px;">
                                <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                    <tr>
                                        <td style="color: #153643; font-family: Arial, sans-serif; font-size: 19px;">
                                            <b>Configuración de Contraseña: ${username}</b>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 25px 0 10px 0; color: #153643; font-family: Arial, sans-serif; font-size: 16px; line-height: 20px;">
                                            Click en el siguiente link para configurar su contraseña: <br>
                                        </td>
                                    </tr>
                                     <tr>
                                        <td style="padding: 10px 0 10px 0; color: #153643; font-family: Arial, sans-serif; font-size: 16px; line-height: 20px; text-align: center; font-weight: bold; color: dodgerblue;">
                                            <a href="http://10.30.17.57/gcir/confirm/${userMid}">Configurar Contraseña</a>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 25px 0 10px 0; color: #153643; font-family: Arial, sans-serif; font-size: 16px; line-height: 20px;">
                                           Si el link no funciona por favor copie y pegue la siguiente línea en su navegador:
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0 10px 0; color: #153643; font-family: Arial, sans-serif; font-size: 16px; line-height: 20px; text-align: center;">
                                            http://10.30.17.57/gcir/confirm/${userMid}
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                        <tr>
                            <td bgcolor="#224b99" style="padding: 30px 30px 30px 30px;">
                                <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                    <tr>
                                        <td style="color: #ffffff; font-family: Arial, sans-serif; font-size: 14px; text-align: center" width="75%">
                                            © Gerencia de Construcción e Infraestructura de Red 2024<br/>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
        </body>
        </html>
        `;
    },

    generateBirthdayHTML: function ({workers_names, plural_flag}) {
        return `
            <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
            <html xmlns="http://www.w3.org/1999/xhtml">
            <head>
                <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
                <title>Feliz Cumpleaños!</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
            </head>
            <body style="margin: 0; padding: 0;">
                <h2 style="color: #ff3d00; font-family: candara;">Hola ${workers_names}!</h2>
                <h3 style="color: #002eff; font-family: candara;">En este d&iacute;a especial, la GCIR ${plural_flag ? 'les' : 'te'} desea ¡Muchas Felicidades!, y ¡Deseamos que la ${plural_flag ? 'pasen' : 'pases'} de maravilla al lado de ${plural_flag ? 'sus' : 'tus'} seres queridos!</h3>
                <img src="cid:general_image"/>
            </body>
            </html>
        `;
    },

    // TICKET
    generateTicketCreatedHtml: function ({
        recipientName = "",
        ticketCode = "TCK-00000",
        title = "Nuevo ticket registrado",
        message = "Tu solicitud fue creada y está en cola de atención.",
        status = "Pendiente",
        statusBg = "#FEF3C7",
        statusColor = "#92400E",
        primary = "#2b7fff",
        accent = "#FF3D00",
        pageBg = "#f3f4f6"
    }) {
        return `
        <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
        <html xmlns="http://www.w3.org/1999/xhtml">
            <head>
                <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>${escapeHtml(title)}</title>
            </head>
            <body style="margin:0; padding:0; background:${pageBg};">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:${pageBg};">
                    <tr>
                    <td align="center" style="padding:26px 12px;">
                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="width:600px; max-width:600px;">
                        <tr>
                            <td style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 10px 26px rgba(17,24,39,0.08);">
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                <td style="height:6px; background:${accent};"></td>
                                </tr>
                                <tr>
                                <td style="padding:18px 20px;">
                                    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,'Noto Sans',sans-serif;">
                                    <div style="font-size:13px; color:#374151;">
                                        Hola <span style="font-weight:800; color:${primary};">${escapeHtml(recipientName || "usuario")}</span>
                                    </div>

                                    <div style="height:8px;"></div>

                                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                        <tr>
                                        <td style="color:${primary}; font-size:16px; font-weight:900;">
                                            ${escapeHtml(title)}
                                        </td>
                                        <td align="right">
                                            <span style="display:inline-block; padding:6px 10px; border-radius:999px; background:${statusBg}; color:${statusColor}; font-size:12px; font-weight:800;">
                                            ${escapeHtml(status)}
                                            </span>
                                        </td>
                                        </tr>
                                    </table>

                                    <div style="height:8px;"></div>

                                    <div style="font-size:13px; color:#6b7280; line-height:19px;">
                                        ${escapeHtml(message)}
                                    </div>

                                    <div style="height:14px;"></div>

                                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f9fafb; border:1px solid #eef0f3; border-radius:12px;">
                                        <tr>
                                        <td style="padding:12px 14px;">
                                            <div style="font-size:12px; color:#6b7280; font-weight:700; margin-bottom:8px;">Código</div>
                                            <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace; font-size:18px; font-weight:900; color:${primary}; letter-spacing:0.5px;">
                                                <a href="http://10.30.17.67:8080/budget/analytics/tickets/${ticketCode}" target="_blank">${escapeHtml(ticketCode)}</a>
                                            </div>
                                        </td>
                                        </tr>
                                    </table>

                                    <div style="height:12px;"></div>
                                    <div style="font-size:11px; color:#9ca3af;">
                                        Mensaje automático • No responder
                                    </div>
                                    </div>
                                </td>
                                </tr>
                            </table>
                            </td>
                        </tr>
                        </table>
                    </td>
                    </tr>
                </table>
            </body>
        </html>
        `;
    },

    generateTicketStateChangedHtml: function ({
        recipientName = "",
        ticketCode = "SRQ-00000",
        title = "Actualización de estado de ticket",
        message = "Se realizó un cambio de estado en tu solicitud.",
        prevStatus = "Pendiente CT",
        nextStatus = "Enviado a MG",
        nextStatusBg = "#DBEAFE",
        nextStatusColor = "#1D4ED8",
        comment = "",
        changedBy = "",
        changedAt = "",
        ticketJira = "",
        rq = "",
        primary = "#2b7fff",
        accent = "#FF3D00",
        pageBg = "#f3f4f6"
    }) {
        const safeTicketUrl = `http://10.30.17.67:8080/budget/analytics/tickets/${ticketCode}`;
        const hasComment = String(comment ?? "").trim().length > 0;
        const hasChangedBy = String(changedBy ?? "").trim().length > 0;
        const hasChangedAt = String(changedAt ?? "").trim().length > 0;
        const hasJira = String(ticketJira ?? "").trim().length > 0;
        const hasRq = String(rq ?? "").trim().length > 0;

        return `
        <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
        <html xmlns="http://www.w3.org/1999/xhtml">
            <head>
                <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>${escapeHtml(title)}</title>
            </head>
            <body style="margin:0; padding:0; background:${pageBg};">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:${pageBg};">
                    <tr>
                        <td align="center" style="padding:26px 12px;">
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="width:600px; max-width:600px;">
                                <tr>
                                    <td style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 10px 26px rgba(17,24,39,0.08);">
                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr>
                                                <td style="height:6px; background:${accent};"></td>
                                            </tr>

                                            <tr>
                                                <td style="padding:18px 20px;">
                                                    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,'Noto Sans',sans-serif;">

                                                        <div style="font-size:13px; color:#374151;">
                                                            Hola <span style="font-weight:800; color:${primary};">${escapeHtml(recipientName || "usuario")}</span>
                                                        </div>

                                                        <div style="height:8px;"></div>

                                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                            <tr>
                                                                <td style="color:${primary}; font-size:16px; font-weight:900;">
                                                                    ${escapeHtml(title)}
                                                                </td>
                                                                <td align="right">
                                                                    <span style="display:inline-block; padding:6px 10px; border-radius:999px; background:${nextStatusBg}; color:${nextStatusColor}; font-size:12px; font-weight:800;">
                                                                        ${escapeHtml(nextStatus)}
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        </table>

                                                        <div style="height:8px;"></div>

                                                        <div style="font-size:13px; color:#6b7280; line-height:19px;">
                                                            ${escapeHtml(message)}
                                                        </div>

                                                        <div style="height:14px;"></div>

                                                        <!-- Código ticket -->
                                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f9fafb; border:1px solid #eef0f3; border-radius:12px;">
                                                            <tr>
                                                                <td style="padding:12px 14px;">
                                                                    <div style="font-size:12px; color:#6b7280; font-weight:700; margin-bottom:8px;">Código</div>
                                                                    <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace; font-size:18px; font-weight:900; color:${primary}; letter-spacing:0.5px;">
                                                                        <a href="${escapeHtml(safeTicketUrl)}" target="_blank" style="color:${primary}; text-decoration:none;">
                                                                            ${escapeHtml(ticketCode)}
                                                                        </a>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        </table>

                                                        <div style="height:12px;"></div>

                                                        <!-- Cambio de estado -->
                                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #eef0f3; border-radius:12px;">
                                                            <tr>
                                                                <td style="padding:12px 14px;">
                                                                    <div style="font-size:12px; color:#6b7280; font-weight:700; margin-bottom:10px;">Cambio de estado</div>

                                                                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                                        <tr>
                                                                            <td width="45%" valign="top">
                                                                                <div style="font-size:11px; color:#9ca3af; font-weight:700; margin-bottom:6px;">Estado anterior</div>
                                                                                <span style="display:inline-block; padding:6px 10px; border-radius:999px; background:#F3F4F6; color:#374151; font-size:12px; font-weight:800;">
                                                                                    ${escapeHtml(prevStatus)}
                                                                                </span>
                                                                            </td>

                                                                            <td width="10%" align="center" valign="middle" style="font-size:16px; color:#9ca3af; font-weight:700;">
                                                                                →
                                                                            </td>

                                                                            <td width="45%" valign="top" align="right">
                                                                                <div style="font-size:11px; color:#9ca3af; font-weight:700; margin-bottom:6px;">Estado nuevo</div>
                                                                                <span style="display:inline-block; padding:6px 10px; border-radius:999px; background:${nextStatusBg}; color:${nextStatusColor}; font-size:12px; font-weight:800;">
                                                                                    ${escapeHtml(nextStatus)}
                                                                                </span>
                                                                            </td>
                                                                        </tr>
                                                                    </table>
                                                                </td>
                                                            </tr>
                                                        </table>

                                                        ${(hasJira || hasRq || hasChangedBy || hasChangedAt) ? `
                                                        <div style="height:12px;"></div>

                                                        <!-- Datos adicionales -->
                                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #eef0f3; border-radius:12px;">
                                                            <tr>
                                                                <td style="padding:12px 14px;">
                                                                    <div style="font-size:12px; color:#6b7280; font-weight:700; margin-bottom:10px;">Detalles</div>

                                                                    ${hasJira ? `
                                                                    <div style="font-size:13px; color:#374151; line-height:20px; margin-bottom:6px;">
                                                                        <span style="font-weight:700; color:#6b7280;">Ticket Jira:</span>
                                                                        ${escapeHtml(ticketJira)}
                                                                    </div>` : ""}

                                                                    ${hasRq ? `
                                                                    <div style="font-size:13px; color:#374151; line-height:20px; margin-bottom:6px;">
                                                                        <span style="font-weight:700; color:#6b7280;">RQ:</span>
                                                                        ${escapeHtml(rq)}
                                                                    </div>` : ""}

                                                                    ${hasChangedBy ? `
                                                                    <div style="font-size:13px; color:#374151; line-height:20px; margin-bottom:6px;">
                                                                        <span style="font-weight:700; color:#6b7280;">Actualizado por:</span>
                                                                        ${escapeHtml(changedBy)}
                                                                    </div>` : ""}

                                                                    ${hasChangedAt ? `
                                                                    <div style="font-size:13px; color:#374151; line-height:20px;">
                                                                        <span style="font-weight:700; color:#6b7280;">Fecha de actualización:</span>
                                                                        ${escapeHtml(changedAt)}
                                                                    </div>` : ""}
                                                                </td>
                                                            </tr>
                                                        </table>
                                                        ` : ""}

                                                        ${hasComment ? `
                                                        <div style="height:12px;"></div>

                                                        <!-- Comentario -->
                                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#fff7ed; border:1px solid #fed7aa; border-radius:12px;">
                                                            <tr>
                                                                <td style="padding:12px 14px;">
                                                                    <div style="font-size:12px; color:#9a3412; font-weight:700; margin-bottom:8px;">Comentario</div>
                                                                    <div style="font-size:13px; color:#7c2d12; line-height:20px; white-space:pre-line;">
                                                                        ${escapeHtml(comment)}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        </table>
                                                        ` : ""}

                                                        <div style="height:12px;"></div>
                                                        <div style="font-size:11px; color:#9ca3af;">
                                                            Mensaje automático • No responder
                                                        </div>

                                                    </div>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
        </html>
        `;
    }
}