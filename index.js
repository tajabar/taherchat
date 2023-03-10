import fetch from "node-fetch";
import { TranslationServiceClient } from "@google-cloud/translate";
import { Configuration, OpenAIApi } from "openai";
import TelegramBot from "node-telegram-bot-api";
import Replicate from "replicate-js";
import google from "./search.js";
import {
    writeOpened,
    readOpened,
    writeTrial,
    readTrial,
    writeSkip,
    readSkip,
    writeContext,
    readContext,
    readChatSuffix,
    writeChatSuffix,
    writeTemp,
    readTemp,
    writeTime,
    readTime,
    writeMoney,
    readMoney,
} from "./db.js";
import dotenv from "dotenv";
dotenv.config({ override: true });

let CONTEXT_SIZE = 400; // increase can negatively affect your bill, 1 Russian char == 1 token
let MAX_TOKENS = 1000;
let MAX_LENGTH = 300;
let PREMIUM = 2.0;

let MAX_MONEY = 3;
let MAX_GROUP_MONEY = 6;
let PRICE = 5;
let GROUP_PRICE = 10;

let CONTEXT_TIMEOUT = 3600;
let OPENAI_PRICE = 0.002;
let IMAGE_PRICE = 0.002;
let OCR_PRICE = 0.02;

let PROMO_MAX_PER_MINUTE = 15;
let PROMO_MAX_PER_HOUR = 5;
let PROMO = [process.env.GROUP_RU_ID, process.env.GROUP_EN_ID];
let GOOGLE_PROJECT = `projects/${process.env.GOOGLE_KEY}/locations/global`;

const replicate = new Replicate({ token: process.env.REPLICATE_KEY });
const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_KEY }));
const bot = new TelegramBot(process.env.TELEGRAM_KEY, { polling: true });
const translation = new TranslationServiceClient();

const context = readContext();
const skip = readSkip();
const trial = readTrial();
const opened = readOpened();
const temp = readTemp();
const time = readTime();
const money = readMoney();
const chatSuffix = readChatSuffix();
const last = {};
const count = {};

bot.on("pre_checkout_query", async (query) => {
    if (query.total_amount < PRICE * 100) {
        bot.answerPreCheckoutQuery(query.id, false, {
            error_message: "يرجى تحديث الفاتورة باستخدام /payment أمر 😊",
        });
        return;
    }
    console.log("Checkout from ", query.from);
    bot.answerPreCheckoutQuery(query.id, true);
});

bot.on("message", async (msg) => {
    try {
        if (protection(msg)) {
            return;
        }
        // Technical stuff
        const chatId = msg.chat.id;
        const msgL = msg.text?.toLowerCase();
        if (msgL) {
            if (processCommand(chatId, msgL, msg.from?.language_code)) {
                return;
            }
        }
        if (msg.successful_payment) {
            console.log("Payment done for ", chatId, msg.successful_payment.invoice_payload);
            var d = new Date();
            d.setMonth(d.getMonth() + 1);
            opened[msg.successful_payment.invoice_payload ?? chatId] = d;
            writeOpened(opened);
            bot.sendMessage(
                msg.successful_payment.invoice_payload ?? chatId,
                msg.from?.language_code == "ru"
                    ? "Оплата произведена! Спасибо. Бот теперь доступен на один месяц ❤️"
                    : "اكتمل الدفع! شكرا لك. هذا الروبوت متاح الآن لمدة شهر واحد ❤️"
            );
            bot.sendMessage(
                process.env.ADMIN_ID,
                "Произведена оплата от " +
                    msg?.from?.username +
                    " " +
                    msg?.from?.id +
                    " " +
                    msg.successful_payment.invoice_payload
            );
            return;
        }

        trial[chatId] = (trial[chatId] ?? 0) + 1;
        writeTrial(trial);

        if (!(new Date(opened[chatId]) > new Date())) {
            bot.sendMessage(
                chatId,
                msg.from?.language_code == "ru"
                    ? `Полная функциональность появится после оплаты ❤️ Приглашаем вас присоединиться к нашей группе и попробовать бота в ней 😊 ${process.env.GROUP_RU}`
                    : `لكي تستعمل البوت في خاص يجيب عليك ان تدفع ❤️🤓 ويمكنك تجربة بوت مجاناً في مجموعة ${process.env.GROUP_EN} \n طلب تنصيب للبوت خاص راسل:@ta_ja199`
            )
                .then(() => {})
                .catch((e) => {
                    console.error(e.message);
                });
            sendInvoice(chatId, msg.from?.language_code);
            return;
        }

        if (
            !PROMO.includes(String(chatId)) &&
            ((chatId > 0 && money[chatId] > MAX_MONEY) || (chatId < 0 && money[chatId] > MAX_GROUP_MONEY))
        ) {
            console.error("تم اكتشاف إساءة الاستخدام للحساب المدفوع", chatId);
            bot.sendMessage(
                chatId,
                msg.from?.language_code == "ru"
                    ? "Привет! К сожалению, вы превысили лимит запросов 😏 Это не проблема - вы всегда можете приобрести новую подписку! ❤️"
                    : "مرحبا! لسوء الحظ، لقد تجاوزت عدد طلبات الاشتراك 😏 هذه ليست مشكلة - يمكنك دائما شراء واحدة جديدة! ❤️"
            );
            bot.sendMessage(
                process.env.ADMIN_ID,
                "تم اكتشاف إساءة الاستخدام للحساب المدفوع " + chatId + " المحاكمات= " + trial[chatId] + " أموال= " + money[chatId]
            );
            trial[chatId] = 0;
            opened[chatId] = new Date();
            money[chatId] = 0;
            writeTrial(trial);
            writeOpened(opened);
            writeMoney(money);
            return;
        }

        // Brain activity
        context[chatId] = context[chatId]?.slice(-CONTEXT_SIZE * premium(chatId)) ?? "";
        if (time[chatId] && new Date() - new Date(time[chatId]) > CONTEXT_TIMEOUT * 1000) {
            context[chatId] = "";
        }
        time[chatId] = new Date();
        writeTime(time);
        writeContext(context);

        if (msg.photo) {
            // visual hemisphere (left)
            visualToText(chatId, msg);
        }
        if (!msg.text) {
            return;
        }

        // console.log(chatId, msg?.from?.username, msg.text);

        msg.text = msg.text?.substring(0, MAX_LENGTH * premium(chatId));
        if (msgL.startsWith("погугли") || msgL.startsWith("загугли") || msgL.startsWith("google")) {
            textToGoogle(chatId, msg.text.slice(7), msg.from?.language_code);
        } else {
            if (msgL.startsWith("ارسم") || msgL.startsWith("draw") || msgL.startsWith("paint")) {
                // visual hemisphere (left)
                textToVisual(chatId, msgL, msg.from?.language_code);
            } else {
                // audio hemisphere (right)
                textToText(chatId, msg);
            }
        }
    } catch (e) {
        console.error(e.message);
    }
});

const processCommand = (chatId, msg, language_code) => {
    if (msg.startsWith("/command") || msg.startsWith("/help")) {
        bot.sendMessage(
            chatId,
            language_code == "ru"
                ? "Нарисуй <что-то>\nЗагугли/Погугли <что-то>\nСброс\nТемпература 36.5 - 41.5\nПропуск <x>\nОтвечай\nРежим <притворись что ты ...>\nЧерез английский <запрос>\n/payment\n/terms\n/terms_group\n/status\n/support"
                : "Paint(طلاء)<لطلاء رسمه ما>\nDraw(رسم) <فقط انكليزي>\nGoogle كوكل<someبعض>\nتنضيف\nTemperature(درجة الحرارة)36.5 - 41.5\nSkip(تخطي) <x>\nAnswer(اجابة)\nMode(وضع) <تظاهر بأنك ...>\n/payment\n/terms\n/terms_group\n/status\n/support"
        );
        return true;
    }
    if (msg.startsWith("/start")) {
        bot.sendMessage(
            chatId,
            language_code == "ru"
                ? `Привет! Я ChatGPT бот. Я могу говорить с вами на любом языке. Я могу нарисовать все что вы хотите. Вы также можете отправить мне изображение, и я переведу его в текст. Я могу искать в Google любую информацию, которая вам нужна. Используйте /help для списка команд 😊 \n\nНаша группа: ${process.env.GROUP_RU}`
                : `مرحبا! أنا ChatGPT. لا تتردد في التحدث معي بأي لغة. يمكنني أن أرسم <أي شيء> تريده. يمكنك أيضا أن ترسل لي صورة، وسأترجمها إلى نص. يمكنني البحث في جوجل عن أي معلومات تحتاجها. استخدم /help لمزيد من الخيارات 😊 \n\nانظم للمجموعة لكي يعمل البوت معك مجاناً: ${process.env.GROUP_EN}\n\n للمزيد من مساعدة راسل مطور البوت:@ta_ja199 `
        );
        return true;
    }
    if (msg.startsWith("/terms_group")) {
        bot.sendMessage(
            chatId,
            language_code == "ru"
                ? `После оплаты подписки $${GROUP_PRICE} вы можете использовать все функции ChatGPT бота в течение месяца для всей группы (без ограничения количества людей), включая Нарисуй, Загугли, и другие.`
                : `بعد إجراء دفعة من $${GROUP_PRICE}, ستتمكن من الوصول إلى روبوت ChatGPT لمدة شهر واحد للمجموعة بأكملها  (عدد غير محدود من الأشخاص) ، مع ميزات كاملة (بما في ذلك الطلاء ، نص الصورة 2 ، Google ، وأكثر)`
        );
        return true;
    }
    if (msg.startsWith("/terms")) {
        bot.sendMessage(
            chatId,
            language_code == "ru"
                ? `После оплаты подписки $${PRICE} в течение месяца вы можете использовать все функции бота, включая Нарисуй, Загугли, и другие без каких-либо ограничений`
                : `بعد إجراء دفعة من $${PRICE}, ستتمكن من الوصول إلى روبوت ChatGPT لمدة شهر واحد، مع ميزات كاملة (بما في ذلك Paint وPhoto2Text وGoogle والمزيد) دون أي قيود`
        );
        return true;
    }

    if (msg.startsWith("/payment")) {
        sendInvoice(chatId, language_code);
        return true;
    }
    if (msg.startsWith("/support")) {
        bot.sendMessage(
            chatId,
            language_code == "ru"
                ? `Если у вас возникли проблемы с оплатой, пожалуйста, напишите мне в личные сообщения @${process.env.ADMIN}`
                : `لأي استفسارات تتعلق بالمبالغ المستردة والإلغاءات، يرجى الاتصال @${process.env.ADMIN}`
        );
        return true;
    }
    if (msg.startsWith("/usage")) {
        bot.sendMessage(chatId, getReport());
        return true;
    }
    if (msg.startsWith("/status")) {
        bot.sendMessage(
            chatId,
            language_code == "ru"
                ? opened[chatId] && new Date(opened[chatId]) > new Date()
                    ? "Ваша подписка активна до " + opened[chatId]
                    : "У вас нет подписки"
                : opened[chatId] && new Date(opened[chatId]) > new Date()
                ? "لديك اشتراك نشط حتى " + opened[chatId]
                : "ليس لديك اشتراك"
        );
        return true;
    }
    if (msg === "сброс") {
        bot.sendMessage(chatId, "Личность уничтожена");
        context[chatId] = "";
        chatSuffix[chatId] = "";
        writeChatSuffix(chatSuffix);
        return true;
    }
    if (msg === "تنظيف") {
        bot.sendMessage(chatId, "تنظيف محتويات");
        context[chatId] = "";
        chatSuffix[chatId] = "";
        writeChatSuffix(chatSuffix);
        return true;
    }
    if (msg.startsWith("пропуск ")) {
        skip[chatId] = +msg.slice(8);
        writeSkip(skip);
        bot.sendMessage(chatId, "قم بالرد مرة واحدة " + skip[chatId]);
        return true;
    }
    if (msg.startsWith("skip ")) {
        skip[chatId] = +msg.slice(5);
        writeSkip(skip);
        bot.sendMessage(chatId, "Skip " + skip[chatId]);
        return true;
    }
    if (msg.startsWith("отвечать раз в ")) {
        skip[chatId] = +msg.slice(15);
        writeSkip(skip);
        bot.sendMessage(chatId, "قم بالرد مرة واحدة " + skip[chatId]);
        return true;
    }

    if (msg === "режим" || msg === "режим обычный") {
        chatSuffix[chatId] = "";
        context[chatId] = "";
        writeChatSuffix(chatSuffix);
        bot.sendMessage(chatId, "Режим обычный");
        return true;
    }
    if (msg.startsWith("режим ")) {
        chatSuffix[chatId] = "(" + msg.substring(6, 100) + ")";
        context[chatId] = "";
        writeChatSuffix(chatSuffix);
        bot.sendMessage(chatId, "Режим установлен");
        return true;
    }
    if (msg === "mode" || msg === "الوضع المعتاد") {
        chatSuffix[chatId] = "";
        context[chatId] = "";
        writeChatSuffix(chatSuffix);
        bot.sendMessage(chatId, "الوضع المعتاد");
        return true;
    }
    if (msg.startsWith("mode ")) {
        chatSuffix[chatId] = "(" + msg?.substring(5, 100) + ")";
        context[chatId] = "";
        writeChatSuffix(chatSuffix);
        bot.sendMessage(chatId, "تم ضبط الوضع");
        return true;
    }

    if (msg.startsWith("температура ")) {
        temp[chatId] = +msg.slice(12)?.replace(",", ".");
        writeTemp(temp);
        bot.sendMessage(chatId, "Температура установлена в " + temp[chatId]);
        return true;
    }

    if (msg.startsWith("temperature ")) {
        temp[chatId] = +msg.slice(12)?.replace(",", ".");
        writeTemp(temp);
        bot.sendMessage(chatId, "تم ضبط درجة الحرارة على " + temp[chatId]);
        return true;
    }
};

const sendInvoice = (chatId, language_code) => {
    bot.sendInvoice(
        chatId,
        language_code == "ru" ? "Требуется оплата" : "تحتاج الى دفع ",
        language_code == "ru" ? "Подписка ChatGPT на 1 месяц" : "الوصول لمدة شهر واحد إلى ChatGPT\n راسل مطور قبل دفع:@ta_ja199",
        chatId,
        process.env.STRIPE_KEY,
        "USD",
        [
            {
                label:
                    chatId > 0
                        ? language_code == "ru"
                            ? "Полный доступ к P2P чату"
                            : "الوصول الكامل إلى دردشة مع البوت"
                        : language_code == "ru"
                        ? "Полный доступ к групповому чату"
                        : "الوصول الكامل إلى الدردشة الجماعية",
                amount: chatId > 0 ? PRICE * 100 : GROUP_PRICE * 100,
            },
        ],
        {
            photo_url: "https://www.linkpicture.com/q/PNG_2.png",
            need_name: false,
            need_phone_number: false,
            need_email: false,
            need_shipping_address: false,
        }
    )
        .then(() => {})
        .catch((e) => {
            console.error(e.message);
        });
};

const visualToText = async (chatId, msg) => {
    bot.sendChatAction(chatId, "typing");
    const intervalId = setInterval(() => {
        bot.sendChatAction(chatId, "typing")
            .then(() => {})
            .catch((e) => {
                console.error(e.message);
            });
    }, 2000);
    let prompt = await getPrompt(msg.photo);
    clearInterval(intervalId);
    if (prompt) {
        // link between left and right hemisphere (computer vision)
        money[chatId] = (money[chatId] ?? 0) + OCR_PRICE;
        writeMoney(money);
        bot.sendChatAction(chatId, "typing");
        last[chatId] = prompt;
        if (msg.from?.language_code == "ru") {
            prompt = await translate(prompt, "ru");
        }
        if (prompt) {
            context[chatId] = context[chatId] + prompt;
            writeContext(context);
            bot.sendMessage(chatId, prompt)
                .then(() => {})
                .catch((e) => {
                    console.error(e.message);
                });
        }
    }
};

const textToVisual = async (chatId, text, language_code) => {
    bot.sendChatAction(chatId, "typing");
    if (text === "ارسم" || text === "draw" || text === "paint") {
        // link between right and left hemisphere (painting)
        text = last[chatId]?.replace("child", "");
    }
    if ((language_code == "ru" && !text?.startsWith("draw")) || text?.startsWith("ارسم")) {
        text = await translate(text?.replace("draw", ""), "en");
    }
    if (!text) {
        return;
    }
    bot.sendChatAction(chatId, "typing");
    const photo = await getArt(
        text +
            (text?.startsWith("draw")
                ? ""
                : ", تركيز عميق، مفصل للغاية، لوحة رقمية، محطة فنية، 4K، تركيز سلس وحاد، توضيح")
    );
    if (photo) {
        money[chatId] = (money[chatId] ?? 0) + IMAGE_PRICE;
        writeMoney(money);
        bot.sendPhoto(chatId, photo);
    }
};

const textToText = async (chatId, msg) => {
    count[chatId] = (count[chatId] ?? 0) + 1;
    context[chatId] += msg.text + ".";
    if (
        !(
            msg.text?.toLowerCase()?.startsWith("отвечай") ||
            msg.text?.toLowerCase()?.startsWith("ответь") ||
            msg.text?.toLowerCase()?.startsWith("answer") ||
            msg.text?.toLowerCase()?.startsWith("через английский")
        ) &&
        count[chatId] % (skip[chatId] ?? 1) != 0
    ) {
        trial[chatId] = trial[chatId] - 1;
        return;
    }
    const english = msg.from?.language_code != "en" && msg.text?.toLowerCase()?.startsWith("через английский");
    if (english) {
        msg.text = msg.text.slice(17);
    }
    bot.sendChatAction(chatId, "typing");
    const intervalId = setInterval(() => {
        bot.sendChatAction(chatId, "typing")
            .then(() => {})
            .catch((e) => {
                console.error(e.message);
            });
    }, 2000);
    let prompt = context[chatId] + chatSuffix[chatId] ?? "";
    if (english) {
        prompt = await translate(msg.text, "en");
    }
    let response;
    if (prompt) {
        response = await getText(
            prompt,
            ((temp[chatId] ?? 36.5) - 36.5) / 10 + 0.5,
            MAX_TOKENS * premium(chatId),
            chatId
        );
    }
    if (english && response) {
        response = await translate(response, msg.from?.language_code);
    }
    clearInterval(intervalId);
    if (response) {
        last[chatId] = response;
        context[chatId] = context[chatId] + response;
        writeContext(context);
        bot.sendMessage(chatId, response)
            .then(() => {})
            .catch((e) => {
                console.error(e.message);
            });
    }
};

const textToGoogle = async (chatId, msg, language_code) => {
    bot.sendChatAction(chatId, "typing");
    const response = await google(msg, language_code);
    if (response) {
        last[chatId] = response;
        context[chatId] = context[chatId] + response;
        writeContext(context);
        bot.sendMessage(chatId, response)
            .then(() => {})
            .catch((e) => {
                console.error(e.message);
            });
    }
};

const getText = async (prompt, temperature, max_tokens, chatId) => {
    try {
        const completion = await openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            max_tokens: max_tokens,
            temperature: temperature,
        });
        const response = completion?.data?.choices?.[0]?.message?.content;
        const spent = (completion?.data?.usage?.total_tokens / 1000) * OPENAI_PRICE;
        if (spent) {
            money[chatId] = (money[chatId] ?? 0) + spent;
            writeMoney(money);
        }
        // console.log(response);
        return response;
    } catch (e) {
        console.error(e.message);
        // if (e.message?.includes("429")) {
        //     bot.sendMessage(process.env.ADMIN_ID, e.message);
        // }
    }
};

const getArt = async (prompt) => {
    const response = await fetch(
        "https://api.stability.ai/v1alpha/generation/stable-diffusion-512-v2-1/text-to-image",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "image/png",
                Authorization: process.env.STABILITY_KEY,
            },
            body: JSON.stringify({
                cfg_scale: 7,
                clip_guidance_preset: "FAST_BLUE",
                height: 512,
                width: 512,
                samples: 1,
                steps: 30,
                text_prompts: [
                    {
                        text: prompt,
                        weight: 1,
                    },
                ],
            }),
        }
    );

    if (!response.ok) {
        console.error(`Stability AI error: ${(await response.text())?.split("\n")?.[0]?.substring(0, 200)}`);
        return;
    }

    return response.buffer();
};

const getPrompt = async (photo) => {
    const file_id = photo[photo.length - 1].file_id;
    const fileUri = await bot.getFileLink(file_id);
    const img2prompt = await replicate.models.get("methexis-inc/img2prompt");
    return img2prompt.predict({ image: fileUri });
};

const premium = (chatId) => {
    if (opened[chatId] && chatId > 0) {
        return PREMIUM;
    } else {
        return 1;
    }
};

let callsTimestamps = [];
let groupUsers = {};

// once per hour clean groupUsers
setInterval(() => {
    groupUsers = {};
}, 1000 * 60 * 60);

const protection = (msg) => {
    //if user is admin, allow all and switch on server
    if (msg?.from?.username == process.env.ADMIN || msg?.from?.username == process.env.ADMIN2) {
        var d = new Date();
        d.setMonth(d.getMonth() + 1);
        opened[msg.chat.id] = d;
        writeOpened(opened);
        groupUsers = {};
        return false;
    }

    if (msg?.text?.toLowerCase()?.startsWith("usage")) {
        return true;
    }

    // DDOS protection, call not more than 15 per minute for msg.chat.id
    if (PROMO.includes(String(msg.chat.id))) {
        // if reply, return true
        if (msg?.reply_to_message) {
            return true;
        }

        //if msg contains оежим or сброс, return true
        if (
            msg?.text?.toLowerCase()?.startsWith("режим") ||
            msg?.text?.toLowerCase()?.startsWith("сброс") ||
            msg?.text?.toLowerCase()?.startsWith("пропуск") ||
            msg?.text?.toLowerCase()?.startsWith("mode") ||
            msg?.text?.toLowerCase()?.startsWith("reset") ||
            msg?.text?.toLowerCase()?.startsWith("skip")
        ) {
            return true;
        }

        groupUsers[msg?.from?.id] = (groupUsers[msg?.from?.id] ?? 0) + 1;
        if (groupUsers[msg?.from?.id] > PROMO_MAX_PER_HOUR) {
            return true;
        }

        callsTimestamps.push(Date.now());
        callsTimestamps = callsTimestamps.filter((stamp) => Date.now() - stamp < 60000);
        if (callsTimestamps.length >= PROMO_MAX_PER_MINUTE) {
            console.error("تم اكتشاف إساءة استخدام [دقيقة واحدة] من أجل ", msg.chat.id);
            bot.sendMessage(process.env.ADMIN_ID, "تم اكتشاف إساءة استخدام [دقيقة واحدة] من أجل " + chatId);
            opened[msg.chat.id] = new Date();
            return true;
        }
    }
};

const translate = async (text, target) => {
    try {
        const request = {
            parent: GOOGLE_PROJECT,
            contents: [text],
            mimeType: "text/plain",
            targetLanguageCode: target,
        };

        const [response] = await translation.translateText(request);
        return response.translations[0]?.translatedText;
    } catch (e) {
        console.error(e.message);
    }
};

const getReport = () => {
    let result = "";
    const add = (s) => {
        result += s + "\n";
    };

    add("التكاليف التشغيلية");
    add("------------------");
    const totalMoney = Object.keys(opened)
        .filter((t) => money[t])
        .map((k) => {
            add(k + " " + money[k].toFixed(2) + "$");
            return money[k];
        })
        .reduce((a, b) => a + b);
    add("Total " + totalMoney.toFixed(2) + "$");
    add("");

    add("Profit");
    add("------------------");
    const revenue = Object.keys(opened).length * PRICE;
    add(revenue + "$ - " + totalMoney.toFixed(2) + "$ = " + (revenue - totalMoney).toFixed(2) + "$");

    return result;
};

process.env["NTBA_FIX_350"] = 1;
process.env["NODE_NO_WARNINGS"] = 1;
process.env["GOOGLE_APPLICATION_CREDENTIALS"] = "./google.json";
