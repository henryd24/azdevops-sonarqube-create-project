import fetch from 'node-fetch';

export class Settings{
    baseURL: string;
    sonarToken:string;
    constructor(baseURL:string,sonarToken:string){
        this.baseURL = baseURL;
        this.sonarToken = sonarToken;
    }
    async setLongLiveBranches(serviceName: string|undefined,longlivebranches: string|undefined){
        const setLongLiveBranches: string = `${this.baseURL}/api/settings/set?component=${serviceName}&key=sonar.branch.longLivedBranches.regex&value=${longlivebranches}`;
        const base64_token: string = Buffer.from(this.sonarToken+':').toString('base64')
        await fetch(setLongLiveBranches, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + base64_token
            }
        })
        .then(response => response.status)
        .then(statusCode =>{
            if(statusCode == 204){
                console.info(`Longlivebranches pattern: ${longlivebranches} were set correctly`)
            }else{
                console.warn(`Unable to set long duration pattern, error code: ${statusCode}`)
            }
        })
        .catch(error => {
            console.error(error);
        })
    }
}