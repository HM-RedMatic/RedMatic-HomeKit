const path = require('path');
const net = require('net');
const hap = require('hap-nodejs');

const {uuid, Accessory, Service} = hap;
const {FFMPEG} = require('homebridge-camera-ffmpeg/ffmpeg');
const pkg = require('../package.json');

const accessories = {};

module.exports = function (RED) {
    hap.init(path.join(RED.settings.userDir, 'homekit'));

    RED.httpAdmin.get('/redmatic-homekit-camera', (req, res) => {
        if (req.query.config) {
            const acc = accessories[req.query.config];
            if (acc) {
                res.status(200).send(JSON.stringify({setupURI: acc.setupURI()}));
            } else {
                res.status(500).send(JSON.stringify({}));
            }
        } else {
            res.status(404).send(JSON.stringify({}));
        }
    });

    class RedMaticHomeKitCamera {
        constructor(config) {
            RED.nodes.createNode(this, config);

            const that = this;

            function logger(...args) {
                let str = args.join(' ');
                if (str.match(/^(error: )/i)) {
                    str = str.replace(/^error: (.*)/i, '$1');
                    that.error(str);
                } else if (config.debug) {
                    that.debug(str);
                }
            }

            if (accessories[this.id]) {
                this.debug('camera already configured ' + this.name + ' ' + this.id + ' ' + this.username);
                return;
            }

            const [firstLogger] = Object.keys(RED.settings.logging);
            config.debug = config.debug && (RED.settings.logging[firstLogger].level === 'debug' || RED.settings.logging[firstLogger].level === 'trace');

            this.name = config.name || ('Camera ' + this.id);

            const acc = new Accessory(this.name, uuid.generate(config.id), Accessory.Categories.CAMERA);
            accessories[this.id] = acc;

            this.debug('camera created' + this.name + ' ' + this.id + ' ' + config.username);

            acc.getService(Service.AccessoryInformation)
                .setCharacteristic(hap.Characteristic.Manufacturer, 'RedMatic')
                .setCharacteristic(hap.Characteristic.Model, 'Camera')
                .setCharacteristic(hap.Characteristic.SerialNumber, config.username)
                .setCharacteristic(hap.Characteristic.FirmwareRevision, pkg.version);

            acc.on('identify', (paired, callback) => {
                this.log('identify ' + this.id + ' ' + this.username + ' ' + paired);
                callback();
            });

            config.audio = Boolean(config.audio);

            if (config.doorbell) {
                this.debug('add doorbell service');
                const doorbellService = acc.addService(hap.Service.Doorbell, this.name);
                this.on('input', msg => {
                    console.log(msg);
                    this.debug('update ProgrammableSwitchEvent SINGLE_PRESS');
                    doorbellService.getCharacteristic(hap.Characteristic.ProgrammableSwitchEvent).updateValue(0);
                });
            }

            const cameraSource = new FFMPEG(hap, {name: this.name, videoConfig: config}, logger, config.videoProcessor || 'ffmpeg');
            this.debug('add cameraSource');

            acc.configureCameraSource(cameraSource);

            this.log('publishing camera ' + this.name + ' ' + config.username);
            const testPort = net.createServer()
                .once('error', err => {
                    this.error(err);
                    this.status({fill: 'red', shape: 'dot', text: err.message});
                })
                .once('listening', () => {
                    testPort.once('close', () => {
                        acc.publish({
                            username: config.username,
                            port: config.port,
                            pincode: config.pincode,
                            category: Accessory.Categories.CAMERA
                        });

                        acc._server.on('listening', () => {
                            this.log('camera ' + this.name + ' listening on port ' + config.port);
                            this.status({fill: 'green', shape: 'ring', text: ' '});
                        });

                        acc._server.on('pair', username => {
                            this.log('camera ' + this.name + ' paired', username);
                        });

                        acc._server.on('unpair', username => {
                            this.log('camera ' + this.name + ' unpaired', username);
                        });

                        acc._server.on('verify', () => {
                            this.log('camera ' + this.name + ' verify');
                        });
                    }).close();
                })
                .listen(config.port);

            this.on('close', () => {
            });
        }
    }

    RED.nodes.registerType('redmatic-homekit-camera', RedMaticHomeKitCamera);
};
