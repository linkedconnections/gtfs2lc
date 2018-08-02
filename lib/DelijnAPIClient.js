const uriTemplate = require('uri-templates');
const request = require('request');

class DelijnAPIClient {
    constructor() {
        this._apiKeyHeader = { 'Ocp-Apim-Subscription-Key': '32654c63bee6428fab855c1e7027d156' };
        this._getZonesURI = 'https://api.delijn.be/DLKernOpenData/v1/beta/entiteiten';
        this._stopsByZoneURI = uriTemplate('https://api.delijn.be/DLKernOpenData/v1/beta/entiteiten/{entiteitnummer}/haltes');
    }

    getZones() {
        return new Promise((resolve, reject) => {
            let options = {
                url: this._getZonesURI,
                headers: this._apiKeyHeader
            };

            request(options, (error, res, body) => {
                if(error) {
                    reject(error);
                } else {
                    resolve(JSON.parse(body));
                }
            });
        });
    }

    getStopsByZone(zone) {
        return new Promise((resolve, reject) => {
            let uri = this._stopsByZoneURI.fill({'entiteitnummer': zone});

            let options = {
                url: uri,
                headers: this._apiKeyHeader
            };

            request(options, (error, res, body) => {
                if(error) {
                    reject(error);
                } else {
                    resolve(JSON.parse(body));
                }
            });
        });
    }
}

module.exports = DelijnAPIClient;