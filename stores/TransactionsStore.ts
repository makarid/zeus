import { action, reaction, observable } from 'mobx';
import Transaction from './../models/Transaction';
import TransactionRequest from './../models/TransactionRequest';
import SettingsStore from './SettingsStore';
import RESTUtils from './../utils/RESTUtils';
import ErrorUtils from './../utils/ErrorUtils';
import { randomBytes } from 'react-native-randombytes';
import { sha256 } from 'js-sha256';
import { Buffer } from 'buffer';

const keySendPreimageType = '5482373484';
const preimageByteLength = 32;

export default class TransactionsStore {
    @observable loading: boolean = false;
    @observable error: boolean = false;
    @observable error_msg: string | null;
    @observable transactions: Array<Transaction> = [];
    @observable transaction: Transaction;
    @observable payment_route: any; // Route
    @observable payment_preimage: string | null;
    @observable payment_hash: any;
    @observable payment_error: any;
    @observable onchain_address: string;
    @observable txid: string | null;
    // c-lightning
    @observable status: string | null;

    settingsStore: SettingsStore;

    constructor(settingsStore: SettingsStore) {
        this.settingsStore = settingsStore;

        reaction(
            () => this.settingsStore.settings,
            () => {
                if (this.settingsStore.macaroonHex) {
                    this.getTransactions();
                }
            }
        );
    }

    @action
    public getTransactions = () => {
        this.loading = true;
        RESTUtils.getTransactions(this.settingsStore)
            .then((response: any) => {
                const status = response.info().status;
                if (status == 200) {
                    // handle success
                    const data = response.json();
                    const transactions = data.transactions || data.outputs;
                    this.transactions = transactions
                        .slice()
                        .reverse()
                        .map((tx: any) => new Transaction(tx));
                    this.loading = false;
                } else {
                    this.transactions = [];
                    this.loading = false;
                }
            })
            .catch(() => {
                // handle error
                this.transactions = [];
                this.loading = false;
            });
    };

    @action
    public sendCoins = (transactionRequest: TransactionRequest) => {
        this.error = false;
        this.error_msg = null;
        this.txid = null;
        this.loading = true;
        RESTUtils.sendCoins(this.settingsStore, transactionRequest)
            .then((response: any) => {
                const status = response.info().status;
                if (status == 200) {
                    // handle success
                    const data = response.json();
                    this.txid = data.txid;
                    this.loading = false;
                } else {
                    const errorInfo = response.json();
                    this.error_msg = errorInfo.error.message || errorInfo.error;
                    this.error = true;
                    this.loading = false;
                }
            })
            .catch((error: any) => {
                // handle error
                this.error_msg = error.toString();
                this.error = true;
                this.loading = false;
            });
    };

    sendPayment = (
        payment_request?: string | null,
        amount?: string,
        pubkey?: string
    ) => {
        const { implementation } = this.settingsStore;

        this.loading = true;
        this.error_msg = null;
        this.error = false;
        this.payment_route = null;
        this.payment_preimage = null;
        this.payment_hash = null;
        this.payment_error = null;
        this.status = null;

        let data;
        if (implementation === 'c-lightning-REST') {
            if (amount) {
                data = {
                    invoice: payment_request,
                    amount: Number(amount) * 1000
                };
            } else {
                data = {
                    invoice: payment_request
                };
            }
        } else {
            if (pubkey) {
                const preimage = randomBytes(preimageByteLength);
                const secret = preimage.toString('base64');
                const payment_hash = Buffer.from(
                    sha256(preimage),
                    'hex'
                ).toString('base64');

                data = {
                    amt: amount,
                    dest_string: pubkey,
                    dest_custom_records: { [keySendPreimageType]: secret },
                    payment_hash
                };
            } else {
                if (amount) {
                    data = {
                        amt: amount,
                        payment_request
                    };
                } else {
                    data = {
                        payment_request
                    };
                }
            }
        }

        RESTUtils.payLightningInvoice(this.settingsStore, data)
            .then((response: any) => {
                const status = response.info().status;
                if (status == 200) {
                    // handle success
                    const data = response.json();
                    this.loading = false;
                    this.payment_route = data.payment_route;
                    this.payment_preimage = data.payment_preimage;
                    this.payment_hash = data.payment_hash;
                    if (data.payment_error !== '') {
                        this.payment_error = data.payment_error;
                    }
                    this.status = data.status;
                } else {
                    const errorInfo = response.json();
                    this.error_msg =
                        errorInfo.error.message ||
                        ErrorUtils.errorToUserFriendly(code) ||
                        errorInfo.message ||
                        errorInfo.error ||
                        'Error sending payment';
                    this.error = true;
                    this.loading = false;
                }
            })
            .catch((error: any) => {
                // handle error
                this.error = true;
                this.loading = false;
                this.error_msg = error.toString() || 'Error sending payment';
            });
    };
}
