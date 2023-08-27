import fetch from 'node-fetch';

export class QualityGate{
    baseURL: string;
    sonarToken:string;
    constructor(baseURL:string,sonarToken:string){
        this.baseURL = baseURL;
        this.sonarToken = sonarToken;
    }
    async setQualityGate(serviceName: string|undefined,gateId: string|undefined){
        const setQualityGate: string = `${this.baseURL}/api/qualitygates/select?projectKey=${serviceName}&gateId=${gateId}`;
        const base64_token: string = Buffer.from(this.sonarToken+':').toString('base64')
        await fetch(setQualityGate, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + base64_token
            }
        })
        .then(response => response.status)
        .then(statusCode =>{
            if(statusCode == 204){
                console.info(`The quality gate with id: ${gateId} was configured correctly.`)
            }else{
                console.warn(`Failed to configure qualitygate, error code: ${statusCode}`)
            }
        })
        .catch(error => {
            console.error(error);
        })
    }
}