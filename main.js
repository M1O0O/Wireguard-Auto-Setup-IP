var fs = require('fs'),
    shell = require('shelljs'),
    { Wg } = require('wireguard-wrapper'),
    rcLocal = {},
    bridge = 0,
    Count = 0;

if (process.env.npm_config_ip) var ips = process.env.npm_config_ip.split('-');

fs.readFileSync('/etc/rc.local', 'utf-8').split(/\r?\n/).forEach(function (line) {
    if (line.length < 1) return;
    if (line.includes('ifconfig')) {
        var ip = line.split('ifconfig eth0:')[1].substring(1).substring(1);
        if (process.env.npm_config_ip) ips.forEach(IPToAdd => {
            if (ip == IPToAdd) {
                console.log(`${IPToAdd} has already added`);
                process.exit();
            }
        });
        rcLocal[ip] = [line];
        bridge++
        Count++;
    } else if (bridge == 1) {
        Object.values(rcLocal)[Count - 1].push(line);
    } else if (line.includes('iptables -t nat -A PREROUTING -d')) return bridge--;
});

function AddInRCLocal() {
    ips.forEach((IPToAdd, count) => {
        count = count + 2
        fs.appendFile('/etc/rc.local', `\n
ifconfig eth0:${count - 2} ${IPToAdd}
iptables -t nat -A POSTROUTING -p udp --sport 58718 -d ${IPToAdd} -o eth0 -j SNAT --to-source 10.66.66.1:58718
iptables -t nat -A POSTROUTING -s 10.66.66.${count} -j SNAT -o eth0 --to-source ${IPToAdd}
iptables -t nat -A PREROUTING -p udp --dport 58718 -d ${IPToAdd} -i eth0 -j DNAT --to-destination 10.66.66.1:58718
iptables -t nat -A PREROUTING -d ${IPToAdd} -i eth0 -j DNAT --to-destination 10.66.66.${count}`, function (err) { })
        console.log(`IP ${IPToAdd} added in rc.local !`);
    });

}

async function AddInConfig() {
    ips.forEach(async (IPToAdd, count) => {

        var SERVER_PRIV_KEY = await Wg.genkey();

        await fs.readFileSync('/etc/wireguard/wg0.conf', 'utf-8').split(/\r?\n/).forEach(async function (line) {
            if (line.includes("PrivateKey = ")) {
                var key = line.split("PrivateKey = ")[1]
                return SERVER_PRIV_KEY = await key;
            }
        });

        var CLIENT_PRIV_KEY = await Wg.genkey(),
            CLIENT_PUB_KEY = await Wg.pubkey(CLIENT_PRIV_KEY),
            SERVER_PUB_KEY = await Wg.pubkey(SERVER_PRIV_KEY),
            CLIENT_PRE_SHARED_KEY = await Wg.genpsk();

        fs.writeFileSync(`/root/VPN-${IPToAdd}.conf`, ` 
[Interface]
PrivateKey = ${CLIENT_PRIV_KEY}
Address = 10.66.66.${count + 2}/32
DNS = 1.1.1.1,1.0.0.1

[Peer]
PublicKey = ${SERVER_PUB_KEY}
PresharedKey = ${CLIENT_PRE_SHARED_KEY}
Endpoint = ${IPToAdd}:58718
AllowedIPs = 0.0.0.0/0`)

        fs.appendFile(`/etc/wireguard/wg0.conf`, `
\n### ${IPToAdd}
[Peer]
PublicKey = ${CLIENT_PUB_KEY}
PresharedKey = ${CLIENT_PRE_SHARED_KEY}
AllowedIPs = 10.66.66.${count + 2}/32`, function (err) { })
    });
}

function RunRCLocal() {
    for (let i = 0; i < 15; i++) shell.exec(`ifconfig eth0:${i} down`);
    console.log("-------------------------------");
    console.log("All Interface has been deleted !");
    console.log("-------------------------------");
    setTimeout(() => {
        shell.exec('bash /etc/rc.local && service wg-quick@wg0 restart');
    }, 1500);
}

AddInRCLocal();
AddInConfig();
RunRCLocal();